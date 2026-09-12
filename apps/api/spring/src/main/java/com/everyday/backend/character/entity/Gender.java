package com.everyday.backend.character.entity;

import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import java.util.Arrays;

public enum Gender {
    FEMALE("여성"),
    MALE("남성"),
    OTHER("기타");

    private final String label;

    Gender(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public static Gender fromLabel(String label) {
        return Arrays.stream(values())
                .filter(v -> v.label.equals(label) || v.name().equalsIgnoreCase(label))
                .findFirst()
                .orElseThrow(() -> new CustomException(ErrorCode.INVALID_REQUEST, "알 수 없는 성별입니다: " + label));
    }
}
