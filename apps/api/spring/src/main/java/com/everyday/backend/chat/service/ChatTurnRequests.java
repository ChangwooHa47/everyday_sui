package com.everyday.backend.chat.service;

import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

/** Claim before the paid request. Unknown provider outcomes are never silently submitted twice. */
@Service
@Profile("!baseline")
public class ChatTurnRequests {
    private final JdbcTemplate db;
    private final TransactionTemplate separate;
    public ChatTurnRequests(JdbcTemplate db, PlatformTransactionManager manager) {
        this.db = db;
        separate = new TransactionTemplate(manager);
        separate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public Long claim(UUID request, Long character, Long episode, String content) {
        if (request == null) return null;
        String hash;
        try { hash = java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        return separate.execute(tx -> {
            int inserted = db.update("""
                INSERT INTO everyday.chat_turn_requests(request_id,character_id,character_episode_id,input_hash,status)
                VALUES(?,?,?,?,'pending') ON CONFLICT(request_id) DO NOTHING
                """, request, character, episode, hash);
            if (inserted == 1) return null;
            var row = db.queryForMap("SELECT character_id,character_episode_id,input_hash,status,ai_message_id FROM everyday.chat_turn_requests WHERE request_id=?", request);
            Long storedEpisode = row.get("character_episode_id") == null ? null : ((Number) row.get("character_episode_id")).longValue();
            if (character.longValue() != ((Number) row.get("character_id")).longValue()
                    || !java.util.Objects.equals(episode, storedEpisode) || !hash.equals(row.get("input_hash")))
                throw new ResponseStatusException(HttpStatus.CONFLICT);
            if (!"completed".equals(row.get("status"))) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE);
            return ((Number) row.get("ai_message_id")).longValue();
        });
    }

    public void complete(UUID request, Long message) {
        if (request != null && db.update("UPDATE everyday.chat_turn_requests SET status='completed',ai_message_id=?,updated_at=now() WHERE request_id=? AND status='pending'", message, request) != 1)
            throw new IllegalStateException("Missing chat request claim");
    }

    public void releaseBeforeProvider(UUID request) {
        if (request != null) separate.executeWithoutResult(tx -> db.update("DELETE FROM everyday.chat_turn_requests WHERE request_id=? AND status='pending'", request));
    }
}
