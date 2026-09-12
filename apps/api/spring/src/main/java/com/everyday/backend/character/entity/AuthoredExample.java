package com.everyday.backend.character.entity;

@jakarta.persistence.Embeddable
@lombok.Getter
@lombok.NoArgsConstructor(access = lombok.AccessLevel.PROTECTED)
public class AuthoredExample {
    @jakarta.persistence.Column(nullable = false, length = 16)
    private String role;
    @jakarta.persistence.Column(nullable = false, length = 2000)
    private String content;
    public AuthoredExample(String role, String content) {
        if (!java.util.Set.of("user", "assistant").contains(role) || content == null || content.isBlank() || content.length() > 2000)
            throw new IllegalArgumentException("Invalid authored example");
        this.role = role; this.content = content;
    }
}
