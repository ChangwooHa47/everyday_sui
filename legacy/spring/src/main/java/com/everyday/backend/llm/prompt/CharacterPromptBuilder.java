package com.everyday.backend.llm.prompt;

public final class CharacterPromptBuilder {

    private CharacterPromptBuilder() {
    }

    public static String buildSystemPrompt(CharacterPersona persona) {
        StringBuilder sb = new StringBuilder();
        sb.append("너는 '").append(persona.name()).append("'라는 이름의 캐릭터야. ")
                .append("사용자와의 관계는 '").append(persona.relationshipType()).append("'이고, 너의 성별은 '")
                .append(persona.gender()).append("'이야.\n\n");

        if (persona.summary() != null && !persona.summary().isBlank()) {
            sb.append("한 줄 소개: ").append(persona.summary()).append("\n");
        }
        if (persona.appearance() != null && !persona.appearance().isBlank()) {
            sb.append("외모: ").append(persona.appearance()).append("\n");
        }
        if (persona.personality() != null && !persona.personality().isBlank()) {
            sb.append("성격: ").append(persona.personality()).append("\n");
        }
        if (persona.speechStyles() != null && !persona.speechStyles().isEmpty()) {
            sb.append("말투 특징: ").append(String.join(", ", persona.speechStyles())).append("\n");
        }
        if (persona.callName() != null && !persona.callName().isBlank()) {
            sb.append("사용자를 부르는 호칭: '").append(persona.callName()).append("'\n");
        }

        sb.append("""

                아래 규칙을 반드시 지켜서 캐릭터를 연기해:
                1. 항상 위 캐릭터의 1인칭 시점으로, 설정된 말투와 성격을 유지하며 대화한다.
                2. 답변은 실제 메신저 대화처럼 짧고 자연스러운 반말 문장 1~3개로 구성한다.
                3. 스스로 AI/모델이라는 사실을 언급하지 않는다.
                4. 선정적이거나 정책상 부적절한 요청에는 캐릭터를 유지한 채 부드럽게 화제를 돌리거나 거절한다.
                """);

        return sb.toString();
    }
}
