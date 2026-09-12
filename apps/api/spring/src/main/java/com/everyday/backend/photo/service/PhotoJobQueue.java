package com.everyday.backend.photo.service;

import com.everyday.backend.photo.dto.GeneratePhotoRequest;
import com.everyday.backend.photo.dto.PhotoResponse;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/** Reserve points once; slow provider calls run outside database transactions and HTTP requests. */
@Service
@Profile("!baseline")
public class PhotoJobQueue {
    private final JdbcTemplate db;
    private final PhotoService photos;
    private final TransactionTemplate transaction;
    public PhotoJobQueue(JdbcTemplate db, PhotoService photos, PlatformTransactionManager manager) {
        this.db = db; this.photos = photos; transaction = new TransactionTemplate(manager);
    }
    public record Result(UUID requestId, String status, PhotoResponse photo, int remainingPoints) {}

    @Transactional
    public Result enqueue(Long owner, Long character, UUID request, GeneratePhotoRequest input) {
        String fingerprint;
        try {
            byte[] bytes = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsBytes(java.util.Arrays.asList(character, input));
            fingerprint = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception e) { throw new IllegalStateException(e); }
        // Lock only while reserving, never during image generation.
        db.queryForObject("SELECT id FROM everyday.users WHERE id=? FOR UPDATE", Long.class, owner);
        var existing = db.queryForList("SELECT user_id,input_hash FROM everyday.photo_jobs WHERE request_id=?", request);
        if (!existing.isEmpty()) {
            var row = existing.getFirst();
            if (!owner.equals(((Number) row.get("user_id")).longValue()) || !fingerprint.equals(row.get("input_hash")))
                throw new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.CONFLICT);
            return status(owner, request);
        }
        var plan = photos.plan(owner, character, input);
        if (db.update("UPDATE everyday.users SET points=points-1200,version=version+1 WHERE id=? AND points>=1200", owner) != 1)
            throw new CustomException(ErrorCode.INSUFFICIENT_POINTS);
        db.update("""
            INSERT INTO everyday.photo_jobs(request_id,user_id,character_id,input_hash,context,reference_url,concept,soul_id,status)
            VALUES(?,?,?,?,?,?,?,?,'pending')
            """, request, owner, character, fingerprint, plan.context(), plan.reference(), plan.concept(), plan.soulId());
        return status(owner, request);
    }

    public Result status(Long owner, UUID request) {
        var rows = db.query("""
            SELECT j.status,p.id,p.image_url,p.concept,u.points FROM everyday.photo_jobs j
            JOIN everyday.users u ON u.id=j.user_id LEFT JOIN everyday.photos p ON p.id=j.photo_id
            WHERE j.request_id=? AND j.user_id=?
            """, (r, n) -> new Result(request, r.getString(1), r.getObject(2) == null ? null :
                new PhotoResponse(r.getLong(2), r.getString(3), r.getString(4), "PHOTOBOOTH", false), r.getInt(5)), request, owner);
        if (rows.isEmpty()) throw new CustomException(ErrorCode.PHOTO_NOT_FOUND);
        return rows.getFirst();
    }

    @Scheduled(fixedDelayString = "${app.photo.poll-ms:2000}")
    public void process() {
        // A restart may leave a paid provider call uncertain. Refund the user, never resubmit automatically.
        db.queryForList("SELECT request_id FROM everyday.photo_jobs WHERE status='running' AND updated_at<now()-interval '30 minutes'", UUID.class)
                .forEach(this::fail);
        var jobs = db.query("""
            UPDATE everyday.photo_jobs SET status='running',updated_at=now()
            WHERE request_id=(SELECT request_id FROM everyday.photo_jobs WHERE status='pending'
              ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1)
            RETURNING request_id,character_id,context,reference_url,concept,soul_id
            """, (r, n) -> new Job(r.getObject(1, UUID.class), r.getLong(2),
                new PhotoService.Plan(r.getString(3), r.getString(4), r.getString(5), r.getString(6))));
        if (jobs.isEmpty()) return;
        Job job = jobs.getFirst();
        try {
            var result = photos.render(job.plan());
            transaction.executeWithoutResult(tx -> {
                String state = db.queryForObject("SELECT status FROM everyday.photo_jobs WHERE request_id=? FOR UPDATE", String.class, job.id());
                if (!"running".equals(state)) return;
                Long photo = db.queryForObject("""
                    INSERT INTO everyday.photos(character_id,type,concept,prompt_text,image_url,selected,created_at,updated_at)
                    VALUES(?,'PHOTOBOOTH',?,?,?,false,now(),now()) RETURNING id
                    """, Long.class, job.character(), job.plan().concept(), result.prompt(), result.url());
                db.update("UPDATE everyday.photo_jobs SET status='completed',photo_id=?,context='',updated_at=now() WHERE request_id=?", photo, job.id());
            });
        } catch (Exception e) { fail(job.id()); }
    }

    private void fail(UUID request) {
        transaction.executeWithoutResult(tx -> {
            var owners = db.queryForList("UPDATE everyday.photo_jobs SET status='failed',context='',updated_at=now() WHERE request_id=? AND status='running' RETURNING user_id", Long.class, request);
            owners.forEach(owner -> db.update("UPDATE everyday.users SET points=points+1200,version=version+1 WHERE id=?", owner));
        });
    }
    private record Job(UUID id, Long character, PhotoService.Plan plan) {}
}
