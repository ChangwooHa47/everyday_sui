package com.everyday.backend.chat.service;

import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.llm.LlmMessage;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/** Reads bounded context inside the caller's transaction, after its ownership checks. */
@Service
public class ConversationContext {
    private final ChatMessageRepository messages;

    public ConversationContext(ChatMessageRepository messages) {
        this.messages = messages;
    }

    public List<LlmMessage> forChat(Long characterId) {
        return asLlmMessages(messages.findTop10ByCharacterIdAndCharacterEpisodeIdIsNullOrderByIdDesc(characterId));
    }

    public List<LlmMessage> forEpisode(Long characterId, Long characterEpisodeId) {
        return asLlmMessages(messages.findTop10ByCharacterIdAndCharacterEpisodeIdOrderByIdDesc(characterId, characterEpisodeId));
    }

    public String photoMood(Long characterId) {
        return chronological(messages.findTop5ByCharacterIdAndCharacterEpisodeIdIsNullOrderByIdDesc(characterId)).stream()
                .map(message -> (message.getSender() == MessageSender.USER ? "유저: " : "캐릭터: ") + message.getContent())
                .collect(Collectors.joining(" / "));
    }

    private List<LlmMessage> asLlmMessages(List<ChatMessage> newestFirst) {
        return chronological(newestFirst).stream()
                .map(message -> message.getSender() == MessageSender.USER
                        ? LlmMessage.user(message.getContent())
                        : LlmMessage.assistant(message.getContent()))
                .toList();
    }

    private List<ChatMessage> chronological(List<ChatMessage> newestFirst) {
        var ordered = new ArrayList<>(newestFirst);
        Collections.reverse(ordered);
        return ordered;
    }
}
