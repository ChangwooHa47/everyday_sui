package com.everyday.backend.image;

import java.util.List;

/**
 * 이미지 생성 프로바이더 추상화 (Higgsfield 등). 구현체를 교체해도 이 인터페이스를 사용하는
 * character/photo 서비스는 변경할 필요가 없다.
 */
public interface ImageClient {

    default void requireConfigured() {}

    /**
     * @param prompt            이미지 생성 프롬프트
     * @param referenceImageUrl 인물 일관성을 위한 참조 이미지 URL (없으면 null)
     * @param count             생성할 이미지 수
     * @return 생성된 이미지 URL 목록
     */
    List<String> generateImages(String prompt, String referenceImageUrl, int count);

    default List<String> generateImages(String prompt, String referenceImageUrl, int count, String soulId) {
        return generateImages(prompt, referenceImageUrl, count);
    }

    default boolean soulReady(String soulId) { return false; }

    /**
     * 참조 이미지를 등록해 이후 생성 시 동일 인물로 유지되도록 하는 Soul ID를 발급한다.
     */
    String trainSoul(String referenceImageUrl);
}
