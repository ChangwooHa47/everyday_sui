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

    private final com.everyday.backend.character.service.MarketProductService marketProducts;


    private final ChatMessageRepository chatMessageRepository;
    private final CharacterRepository characterRepository;
    private final LlmClient llmClient;
    private final ChatTurnRequests turns;
    private final ConversationContext conversationContext;
    private final org.springframework.transaction.support.TransactionTemplate transaction;

    public ChatService(ChatMessageRepository chatMessageRepository, CharacterRepository characterRepository,
            LlmClient llmClient, com.everyday.backend.character.service.MarketProductService marketProducts,
            org.springframework.beans.factory.ObjectProvider<ChatTurnRequests> turns,
            ConversationContext conversationContext,
            org.springframework.transaction.PlatformTransactionManager manager) {
        this.marketProducts = marketProducts;
        this.chatMessageRepository = chatMessageRepository;
        this.characterRepository = characterRepository;
        this.llmClient = llmClient;
        this.turns = turns.getIfAvailable();
        this.conversationContext = conversationContext;
        this.transaction = new org.springframework.transaction.support.TransactionTemplate(manager);
    }

    public List<ChatMessageResponse> getMessages(Long userId, Long characterId) {
        return history(userId, characterId);
    }

    public List<ChatMessageResponse> history(Long userId, Long characterId) {
        Character character = characterRepository.findById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        marketProducts.requireAccess(characterId);
        return chatMessageRepository.findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(characterId)
                .stream().map(ChatMessageResponse::from).toList();
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public ChatMessageResponse sendMessage(Long userId, Long characterId, String content, java.util.UUID requestId) {
        // Verify ownership before looking up an idempotent result or committing its claim.
        Character owned = characterRepository.findById(characterId).orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!owned.isOwnedBy(userId)) throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        marketProducts.requireAccess(characterId);
        Long existing = turns == null ? null : turns.claim(requestId, characterId, null, "message:" + content);
        if (existing != null) return ChatMessageResponse.from(chatMessageRepository.findById(existing).orElseThrow());
        var providerStarted = new java.util.concurrent.atomic.AtomicBoolean();
        try {
        return transaction.execute(tx -> {
        Character character = getOwnedCharacter(userId, characterId);

        chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .sender(MessageSender.USER)
                .content(content)
                .build());

        List<LlmMessage> context = conversationContext.forChat(characterId);

        String prompt = marketProducts.withApprovedMemory(characterId, character.getSystemPrompt(), content);
        llmClient.requireConfigured();
        providerStarted.set(true);
        String aiReply = llmClient.generate(prompt, context);

        ChatMessage aiMessage = chatMessageRepository.save(ChatMessage.builder()
                .characterId(characterId)
                .sender(MessageSender.AI)
                .content(aiReply)
                .build());

        if (turns != null) turns.complete(requestId, aiMessage.getId());
        return ChatMessageResponse.from(aiMessage);
        });
        } catch (RuntimeException error) {
            if (!providerStarted.get() && turns != null) turns.releaseBeforeProvider(requestId);
            throw error;
        }
    }

    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.NOT_SUPPORTED)
    public ChatMessageResponse greeting(Long userId, Long characterId, java.util.UUID requestId) {
        Character owned = characterRepository.findById(characterId).orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!owned.isOwnedBy(userId)) throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        marketProducts.requireAccess(characterId);
        Long existing = turns == null ? null : turns.claim(requestId, characterId, null, "greeting");
        if (existing != null) return ChatMessageResponse.from(chatMessageRepository.findById(existing).orElseThrow());
        var providerStarted = new java.util.concurrent.atomic.AtomicBoolean();
        try {
            return transaction.execute(tx -> {
                Character character = getOwnedCharacter(userId, characterId);
                var history = chatMessageRepository.findAllByCharacterIdAndCharacterEpisodeIdIsNullOrderByCreatedAtAsc(characterId);
                var previous = history.stream().filter(m -> m.getSender() == MessageSender.AI).findFirst();
                ChatMessage reply;
                if (previous.isPresent()) reply = previous.get();
                else {
                    llmClient.requireConfigured();
                    providerStarted.set(true);
                    reply = generateGreeting(character);
                }
                if (turns != null) turns.complete(requestId, reply.getId());
                return ChatMessageResponse.from(reply);
            });
        } catch (RuntimeException error) {
            if (!providerStarted.get() && turns != null) turns.releaseBeforeProvider(requestId);
            throw error;
        }
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

    private Character getOwnedCharacter(Long userId, Long characterId) {
        Character character = characterRepository.findForUpdateById(characterId)
                .orElseThrow(() -> new CustomException(ErrorCode.CHARACTER_NOT_FOUND));
        if (!character.isOwnedBy(userId)) {
            throw new CustomException(ErrorCode.FORBIDDEN_CHARACTER_ACCESS);
        }
        marketProducts.requireAccess(characterId);
        return character;
    }
}
