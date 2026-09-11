package com.everyday.backend.character.entity;

import com.everyday.backend.common.entity.BaseTimeEntity;
import com.everyday.backend.user.entity.User;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Lob;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Getter
@Entity
@Table(name = "characters")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Character extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private String name;

    private LocalDate birthday;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private RelationshipType relationshipType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Gender gender;

    @Column(length = 500)
    private String summary;

    @Lob
    private String appearance;

    @Lob
    private String personality;

    @ElementCollection
    @CollectionTable(name = "character_speech_style", joinColumns = @JoinColumn(name = "character_id"))
    @Column(name = "speech_style")
    private List<String> speechStyles = new ArrayList<>();

    @Lob
    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String systemPrompt;

    @Lob
    private String imagePrompt;

    private String profileImageUrl;

    /** 캐릭터가 사용자를 부르는 호칭 (채팅 첫 진입 시 설정) */
    private String callName;

    /** 인물 일관성을 위한 이미지 생성 API의 Soul ID (학습 전에는 null) */
    private String soulId;

    @Builder
    public Character(User user, String name, LocalDate birthday, RelationshipType relationshipType, Gender gender,
            String summary, String appearance, String personality, List<String> speechStyles,
            String systemPrompt, String imagePrompt) {
        this.user = user;
        this.name = name;
        this.birthday = birthday;
        this.relationshipType = relationshipType;
        this.gender = gender;
        this.summary = summary;
        this.appearance = appearance;
        this.personality = personality;
        this.speechStyles = speechStyles != null ? new ArrayList<>(speechStyles) : new ArrayList<>();
        this.systemPrompt = systemPrompt;
        this.imagePrompt = imagePrompt;
    }

    public void updateProfileImage(String imageUrl) {
        this.profileImageUrl = imageUrl;
    }

    public void updateCallName(String callName) {
        this.callName = callName;
    }

    public void updateSoulId(String soulId) {
        this.soulId = soulId;
    }

    public void updateSettings(String appearance, String personality, List<String> speechStyles,
            String regeneratedSystemPrompt) {
        if (appearance != null) {
            this.appearance = appearance;
        }
        if (personality != null) {
            this.personality = personality;
        }
        if (speechStyles != null) {
            this.speechStyles = new ArrayList<>(speechStyles);
        }
        this.systemPrompt = regeneratedSystemPrompt;
    }

    public boolean isOwnedBy(Long userId) {
        return this.user.getId().equals(userId);
    }

    public int calculateAge() {
        if (birthday == null) {
            return 0;
        }
        return java.time.Period.between(birthday, LocalDate.now()).getYears();
    }
}
