package com.everyday.backend.chat;

import com.everyday.backend.chat.entity.ChatMessage;
import com.everyday.backend.chat.entity.MessageSender;
import com.everyday.backend.chat.repository.ChatMessageRepository;
import com.everyday.backend.chat.service.ConversationContext;
import com.everyday.backend.llm.LlmMessage;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.ActiveProfiles;
import static org.assertj.core.api.Assertions.assertThat;

@DataJpaTest
@ActiveProfiles("baseline")
@Import(ConversationContext.class)
class ConversationContextTests {
    @Autowired ChatMessageRepository messages;
    @Autowired ConversationContext context;

    @Test
    void keepsRecentWindowsChronologicalAndSeparatesCharactersAndEpisodes() {
        for (int i = 0; i < 12; i++) {
            var sender = i % 2 == 0 ? MessageSender.USER : MessageSender.AI;
            save(1L, null, sender, "normal-" + i);
            save(1L, 101L, sender, "episode-" + i);
            save(1L, 202L, sender, "other episode");
            save(2L, null, sender, "other character");
        }

        var expectedChat = IntStream.range(2, 12).mapToObj(i ->
                i % 2 == 0 ? LlmMessage.user("normal-" + i) : LlmMessage.assistant("normal-" + i)).toList();
        var expectedEpisode = IntStream.range(2, 12).mapToObj(i ->
                i % 2 == 0 ? LlmMessage.user("episode-" + i) : LlmMessage.assistant("episode-" + i)).toList();
        assertThat(context.forChat(1L)).containsExactlyElementsOf(expectedChat);
        assertThat(context.forEpisode(1L, 101L)).containsExactlyElementsOf(expectedEpisode);
        assertThat(context.photoMood(1L)).isEqualTo(
                "캐릭터: normal-7 / 유저: normal-8 / 캐릭터: normal-9 / 유저: normal-10 / 캐릭터: normal-11");
    }

    @Test
    void hasNoInventedContextForAnEmptyConversation() {
        assertThat(context.forChat(1L)).isEmpty();
        assertThat(context.forEpisode(1L, 101L)).isEmpty();
        assertThat(context.photoMood(1L)).isEmpty();
    }

    private void save(Long character, Long episode, MessageSender sender, String content) {
        messages.save(ChatMessage.builder().characterId(character).characterEpisodeId(episode)
                .sender(sender).content(content).build());
    }
}
