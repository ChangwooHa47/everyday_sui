package com.everyday.backend.character.service;

import com.everyday.backend.character.dto.CompileRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** The durable fingerprint contains no prompt, interview answers or generated persona. */
@Service
@Profile("!baseline")
public class CompileRequests {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;
    public CompileRequests(JdbcTemplate db, ObjectMapper json, PlatformTransactionManager manager) {
        this.db = db; this.json = json; this.transaction = new TransactionTemplate(manager);
    }

    public Long claim(Long owner, CompileRequest input) {
        if (input.requestId() == null) return null;
        String hash;
        try { hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(json.writeValueAsBytes(input))); }
        catch (Exception e) { throw new IllegalStateException(e); }
        return transaction.execute(tx -> {
            int created = db.update("INSERT INTO everyday.character_compile_requests(request_id,user_id,input_hash,status) VALUES(?,?,?,'pending') ON CONFLICT(request_id) DO NOTHING", input.requestId(), owner, hash);
            if (created == 1) return null;
            var row = db.queryForMap("SELECT user_id,input_hash,status,character_id FROM everyday.character_compile_requests WHERE request_id=?", input.requestId());
            if (owner.longValue() != ((Number) row.get("user_id")).longValue() || !hash.equals(row.get("input_hash")))
                throw new ResponseStatusException(HttpStatus.CONFLICT);
            if (!"completed".equals(row.get("status"))) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            return ((Number) row.get("character_id")).longValue();
        });
    }

    public void complete(UUID request, Long character) {
        if (request != null && db.update("UPDATE everyday.character_compile_requests SET status='completed',character_id=?,updated_at=now() WHERE request_id=? AND status='pending'", character, request) != 1)
            throw new IllegalStateException("Missing compile claim");
    }

    public void releaseBeforeProvider(UUID request) {
        if (request != null) transaction.executeWithoutResult(tx -> db.update("DELETE FROM everyday.character_compile_requests WHERE request_id=? AND status='pending'", request));
    }
}
