package com.everyday.backend.character.service;

import java.nio.charset.StandardCharsets;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** One initial registration per character. A missing provider result is not a retry permission. */
@Service
@Profile("!baseline")
public class SoulTrainingRequests {
    private final JdbcTemplate db;
    private final TransactionTemplate transaction;
    public SoulTrainingRequests(JdbcTemplate db, PlatformTransactionManager manager) {
        this.db = db; this.transaction = new TransactionTemplate(manager);
    }

    public String claim(Long character, String reference) {
        String hash;
        try { hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(reference.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        return transaction.execute(tx -> {
            int created = db.update("INSERT INTO everyday.soul_training_requests(character_id,input_hash,status) VALUES(?,?,'pending') ON CONFLICT(character_id) DO NOTHING", character, hash);
            if (created == 1) return null;
            var row = db.queryForMap("SELECT r.input_hash,r.status,c.soul_id FROM everyday.soul_training_requests r JOIN everyday.characters c ON c.id=r.character_id WHERE r.character_id=?", character);
            if (!hash.equals(row.get("input_hash"))) throw new ResponseStatusException(HttpStatus.CONFLICT);
            if (!"completed".equals(row.get("status")) || row.get("soul_id") == null) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            return (String) row.get("soul_id");
        });
    }

    public void complete(Long character) {
        if (db.update("UPDATE everyday.soul_training_requests SET status='completed',updated_at=now() WHERE character_id=? AND status='pending'", character) != 1)
            throw new IllegalStateException("Missing Soul training claim");
    }
}
