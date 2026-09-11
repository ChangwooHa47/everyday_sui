package com.everyday.backend.llm;

public record LlmMessage(Role role, String content) {

    public enum Role {
        USER, ASSISTANT
    }

    public static LlmMessage user(String content) {
        return new LlmMessage(Role.USER, content);
    }

    public static LlmMessage assistant(String content) {
        return new LlmMessage(Role.ASSISTANT, content);
    }
}
