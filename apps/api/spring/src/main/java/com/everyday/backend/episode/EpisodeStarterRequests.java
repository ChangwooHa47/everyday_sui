package com.everyday.backend.episode;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

@Service
@Profile("!baseline")
public class EpisodeStarterRequests {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;
    public EpisodeStarterRequests(JdbcTemplate db, ObjectMapper json, PlatformTransactionManager manager) {
        this.db = db; this.json = json; this.transaction = new TransactionTemplate(manager);
    }

    public List<String> claim(Long episode) {
        return transaction.execute(tx -> {
            int inserted = db.update("INSERT INTO everyday.episode_starter_requests(character_episode_id,status) VALUES(?,'pending') ON CONFLICT(character_episode_id) DO NOTHING", episode);
            if (inserted == 1) return null;
            var row = db.queryForMap("SELECT status,starters::text FROM everyday.episode_starter_requests WHERE character_episode_id=?", episode);
            if (!"completed".equals(row.get("status"))) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            try { return json.readValue((String) row.get("starters"), new com.fasterxml.jackson.core.type.TypeReference<List<String>>() {}); }
            catch (Exception e) { throw new IllegalStateException("Invalid stored episode starters"); }
        });
    }

    public void complete(Long episode, List<String> starters) {
        try {
            if (db.update("UPDATE everyday.episode_starter_requests SET status='completed',starters=?::jsonb,updated_at=now() WHERE character_episode_id=? AND status='pending'", json.writeValueAsString(starters), episode) != 1)
                throw new IllegalStateException("Missing episode starter claim");
        } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException(e); }
    }

    public void releaseBeforeProvider(Long episode) {
        db.update("DELETE FROM everyday.episode_starter_requests WHERE character_episode_id=? AND status='pending'", episode);
    }
}
