package com.everyday.backend.photo.entity;

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
 * 캐릭터의 프로필 후보 사진(PROFILE)과 포토부스 생성 결과(PHOTOBOOTH)를 함께 저장한다.
 * character 패키지에 대한 의존을 피하기 위해 characterId는 연관관계가 아닌 단순 컬럼으로 둔다.
 */
@Getter
@Entity
@Table(name = "photos")
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Photo extends BaseTimeEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Long characterId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private PhotoType type;

    private String concept;

    @Lob
    private String promptText;

    @Column(nullable = false)
    private String imageUrl;

    @Column(nullable = false)
    private boolean selected;

    @Builder
    public Photo(Long characterId, PhotoType type, String concept, String promptText, String imageUrl) {
        this.characterId = characterId;
        this.type = type;
        this.concept = concept;
        this.promptText = promptText;
        this.imageUrl = imageUrl;
        this.selected = false;
    }

    public void markSelected(boolean selected) {
        this.selected = selected;
    }
}
