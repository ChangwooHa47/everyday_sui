package com.everyday.backend.llm;

import java.util.List;

/**
 * LLM 프로바이더 추상화. 구현체를 교체해도(Anthropic → 다른 벤더) 이 인터페이스를 사용하는
 * 도메인 서비스(character/chat/episode/photo)는 변경할 필요가 없다.
 */
public interface LlmClient {

    /**
     * @param systemPrompt 캐릭터 페르소나/지시사항
     * @param messages     최근 대화 히스토리 (오래된 순)
     * @return LLM이 생성한 텍스트 응답
     */
    String generate(String systemPrompt, List<LlmMessage> messages);
}
