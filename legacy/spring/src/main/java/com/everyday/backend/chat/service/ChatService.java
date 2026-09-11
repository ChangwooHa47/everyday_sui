package com.everyday.backend.chat.service;

import com.everyday.backend.character.entity.Character;
import com.everyday.backend.character.repository.CharacterRepository;
import com.everyday.backend.chat.dto.ChatMessageResponse;
import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import com.everyday.backend.llm.LlmClient;
import com.everyday.backend.llm.LlmMessage;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@Transactional(readOnly = true)
public class ChatService {

    private static final int MAX_CONTEXT_MESSAGES = 10;

    private final ChatMessageRepository chatMessageRepository;
    private final CharacterRepository characterRepository;
    private final LlmClient llmClient;

    public ChatService(ChatMessageRepository chatMessageRepository, CharacterRepository characterRepository,
            LlmClient llmClient) {
        this.chatMessageRepository = chatMessageRepository;
        this.characterRepository = characterRepository;
        this.llmClient = llmClient;
    }

    @Transactional
    public List<ChatMessageResponse> getMessages(Long userId, Long characterId) {
        Character character = getOwnedCharacter(userId, characterId);
        List<ChatMessage> history = chatMessageRepository
                .findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(characterId);

        if (history.isEmpty()) {
            ChatMessage greeting = generateGreeting(character);
            history = List.of(greeting);
        }

        return history.stream().map(ChatMessageResponse::from).toList();
    }

    @Transactional
    public ChatMessageResponse sendMessage(Long userId, Long characterId, String content) {
        Character character = getOwnedCharacter(userId, characterId);

        chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .sender(MessageSender.USER)
                .content(content)
                .build());

        List<ChatMessage> recentHistory = lastMessages(characterId);
        List<LlmMessage> context = recentHistory.stream()
                .map(m -> m.getSender() == MessageSender.USER
                        ? LlmMessage.user(m.getContent())
                        : LlmMessage.assistant(m.getContent()))
                .toList();

        String aiReply = llmClient.generate(character.getSystemPrompt(), context);

        ChatMessage aiMessage = chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .sender(MessageSender.AI)
                .content(aiReply)
                .build());

        return ChatMessageResponse.from(aiMessage);
    }

    private ChatMessage generateGreeting(Character character) {
        String reply = llmClient.generate(character.getSystemPrompt(),
                List.of(LlmMessage.user("(오랜만에 먼저 대화를 시작하는 상황이야. 자연스럽게 먼저 인사를 건네줘.)")));

        return chatMessageRepository.save(ChatMessage.builder()
                .characterId(character.getId())
                .sender(MessageSender.AI)
                .content(reply)
                .build());
    }

    private List<ChatMessage> lastMessages(Long characterId) {
        List<ChatMessage> all = chatMessageRepository
                .findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(characterId);
        int fromIndex = Math.max(0, all.size() - MAX_CONTEXT_MESSAGES);
        return all.subList(fromIndex, all.size());
    }

    private Character getOwnedCharacter(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }
        return character;
    }
}
