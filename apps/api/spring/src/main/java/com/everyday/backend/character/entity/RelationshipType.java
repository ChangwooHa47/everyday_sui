package com.everyday.backend.character.entity;

import com.everyday.backend.common.exception.CustomException;
import com.everyday.backend.common.exception.ErrorCode;
import java.util.Arrays;

public enum RelationshipType {
    LOVER("연인"),
    CRUSH("썸"),
    FRIEND("친구"),
    ONE_SIDED_LOVE("짝사랑");

    private final String label;

    RelationshipType(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }

    public static RelationshipType fromLabel(String label) {
        return Arrays.stream(values())
                .filter(v -> v.label.equals(label) || v.name().equalsIgnoreCase(label))
                .findFirst()
                .orElseThrow(() -> new CustomException(ErrorCode.INVALID_REQUEST, "알 수 없는 관계 유형입니다: " + label));
    }
}
