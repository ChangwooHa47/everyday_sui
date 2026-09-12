package com.everyday.backend.character.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "licensed_characters")
@Getter
@NoArgsConstructor
public class LicensedCharacter {
    @Id private Long characterId;
    @Column(nullable = false, length = 66) private String listingId;
    @Column(nullable = false, unique = true, length = 66) private String licenseId;
    @org.hibernate.annotations.JdbcTypeCode(org.hibernate.type.SqlTypes.LONGVARCHAR)
    @Column(nullable = false, columnDefinition = "text") private String basePrompt;
    public LicensedCharacter(Long characterId, String listingId, String licenseId, String basePrompt) {
        this.characterId = characterId; this.listingId = listingId; this.licenseId = licenseId;
        this.basePrompt = basePrompt;
    }
}
