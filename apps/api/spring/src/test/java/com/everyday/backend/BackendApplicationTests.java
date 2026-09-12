package com.everyday.backend;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.context.annotation.Import;
import com.everyday.backend.baseline.BaselineAiConfiguration;

@SpringBootTest
@ActiveProfiles("baseline")
@Import(BaselineAiConfiguration.class)
class BackendApplicationTests {

	@Test
	void contextLoads() {
	}

}
