package com.everyday.backend.chat.repository;

import com.everyday.backend.chat.entity.ChatMessage;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {

    List<ChatMessage> findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(Long characterId);

    List<ChatMessage> findAllByCharacterIdAndCharacterEpisodeIdOrderByCreatedAtAsc(
            Long characterId, Long characterEpisodeId);
}
