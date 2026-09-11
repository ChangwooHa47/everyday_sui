package com.everyday.backend.photo.entity;

import java.util.Arrays;
import java.util.Optional;

public enum PhotoConcept {
    CAFE_DATE("카페 데이트", "따뜻한 조명의 카페에서 다정하게 마주앉은 모습"),
    NIGHT_WALK("밤 산책", "밤에 가로등이 켜진 산책로를 함께 걷는 모습"),
    PHOTO_STRIP("인생네컷", "네컷 사진 부스 스타일의 밝고 장난스러운 표정"),
    CUSTOM("직접 만들기", null);

    private final String label;
    private final String promptHint;

    PhotoConcept(String label, String promptHint) {
        this.label = label;
        this.promptHint = promptHint;
    }

    public String getLabel() {
        return label;
    }

    public String getPromptHint() {
        return promptHint;
    }

    public static Optional<PhotoConcept> fromCodeOrLabel(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        return Arrays.stream(values())
                .filter(v -> v.name().equalsIgnoreCase(value) || v.label.equals(value))
                .findFirst();
    }
}
