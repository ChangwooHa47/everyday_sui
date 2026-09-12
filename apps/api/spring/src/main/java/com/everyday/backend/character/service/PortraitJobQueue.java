package com.everyday.backend.character.service;

import com.everyday.backend.image.ImageClient;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable work records commit with the character. Uncertain paid calls are never auto-retried. */
@Service
@Profile("!baseline")
public class PortraitJobQueue {
    private final JdbcTemplate db;
    private final ImageClient images;
    private final TransactionTemplate transaction;

    public PortraitJobQueue(JdbcTemplate db, ImageClient images, PlatformTransactionManager manager) {
        this.db = db; this.images = images; this.transaction = new TransactionTemplate(manager);
    }

    public void enqueue(Long characterId, String prompt, int count, boolean deferred) {
        db.update("INSERT INTO everyday.portrait_jobs(character_id,image_prompt,image_count,status) VALUES(?,?,?,?)",
                characterId, prompt, count, deferred ? "draft" : "pending");
    }

    public void start(Long characterId, String prompt) {
        int updated = db.update("UPDATE everyday.portrait_jobs SET image_prompt=?,status='pending',updated_at=now() WHERE character_id=? AND status='draft'", prompt, characterId);
        if (updated == 0) {
            String saved = db.queryForObject("SELECT image_prompt FROM everyday.portrait_jobs WHERE character_id=?", String.class, characterId);
            if (!prompt.equals(saved)) throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT);
        }
    }

    public String status(Long characterId) {
        List<String> rows = db.query("SELECT status FROM everyday.portrait_jobs WHERE character_id=?",
                (row, n) -> row.getString(1), characterId);
        return rows.isEmpty() ? "completed" : rows.getFirst();
    }

    @Scheduled(fixedDelayString = "${app.portrait.poll-ms:2000}")
    public void process() {
        db.update("UPDATE everyday.portrait_jobs SET status='unknown',updated_at=now() WHERE status='running' AND updated_at < now()-interval '30 minutes'");
        var jobs = db.query("""
            UPDATE everyday.portrait_jobs SET status='running',updated_at=now()
            WHERE character_id=(SELECT character_id FROM everyday.portrait_jobs
              WHERE status='pending' ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING character_id,image_prompt,image_count
            """, (r, n) -> new Job(r.getLong(1), r.getString(2), r.getInt(3)));
        if (jobs.isEmpty()) return;
        Job job = jobs.getFirst();
        try {
            List<String> urls = images.generateImages(job.prompt(), null, job.count());
            if (urls.size() != job.count()) throw new IllegalStateException("Incomplete portrait result");
            transaction.executeWithoutResult(tx -> {
                for (String url : urls) db.update("""
                    INSERT INTO everyday.photos(character_id,type,prompt_text,image_url,selected,created_at,updated_at)
                    VALUES(?,'PROFILE',?,?,false,now(),now())
                    """, job.id(), job.prompt(), url);
                db.update("UPDATE everyday.portrait_jobs SET status='completed',updated_at=now() WHERE character_id=?", job.id());
            });
        } catch (Exception error) {
            db.update("UPDATE everyday.portrait_jobs SET status='unknown',updated_at=now() WHERE character_id=?", job.id());
        }
    }

    private record Job(Long id, String prompt, int count) {}
}
