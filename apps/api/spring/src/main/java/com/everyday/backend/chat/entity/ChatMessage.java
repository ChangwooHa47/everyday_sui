package com.everyday.backend.chat.entity;

import com.everyday.backend.common.entity.BaseTimeEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Lob;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 일반 채팅과 에피소드 채팅을 함께 저장한다. characterEpisodeId가 null이면 일반 채팅,
 * 값이 있으면 해당 에피소드 진행 회차의 대화다. character/episode 엔티티에 대한 의존을 피하기 위해
 * 두 참조 모두 단순 컬럼(id)으로 둔다.
 */
@Getter
@Entity
@Table(name = "chat_messages")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ChatMessage extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long characterId;

    private Long characterEpisodeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MessageSender sender;

    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.LONGVARCHAR)
    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Builder
    public ChatMessage(Long characterId, Long characterEpisodeId, MessageSender sender, String content) {
        this.characterId = characterId;
        this.characterEpisodeId = characterEpisodeId;
        this.sender = sender;
        this.content = content;
    }
}
