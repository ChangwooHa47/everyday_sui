package com.everyday.backend.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.FilterChain;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class WalletAuthenticationFilterTests {
    private static final String ADDRESS = "0x" + "a".repeat(64);
    private static final String TOKEN = "Bearer " + "a".repeat(43);
    private static final String ORIGIN = "https://web.example";
    private final ObjectMapper json = new ObjectMapper();
    private final AtomicInteger authCalls = new AtomicInteger();
    private HttpServer server;
    private WalletAuthenticationFilter filter;
    private JdbcTemplate db;
    private FilterChain product;
    private int upstreamStatus;
    private String upstreamBody;
    private String retryAfter;

    @BeforeEach
    void setup() throws Exception {
        db = mock(JdbcTemplate.class);
        product = mock(FilterChain.class);
        upstreamStatus = 200;
        upstreamBody = "{\"network\":\"testnet\",\"address\":\"" + ADDRESS + "\"}";
        retryAfter = null;
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/me", exchange -> {
            authCalls.incrementAndGet();
            assertThat(exchange.getRequestHeaders().getFirst("Authorization")).isEqualTo(TOKEN);
            assertThat(exchange.getRequestHeaders().getFirst("Origin")).isEqualTo(ORIGIN);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            if (retryAfter != null) exchange.getResponseHeaders().set("Retry-After", retryAfter);
            byte[] body = upstreamBody.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(upstreamStatus, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        filter = new WalletAuthenticationFilter("http://127.0.0.1:" + server.getAddress().getPort(), db);
    }

    @AfterEach
    void cleanup() {
        SecurityContextHolder.clearContext();
        server.stop(0);
    }

    private MockHttpServletRequest request() {
        var request = new MockHttpServletRequest("POST", "/api/characters/42/messages");
        request.addHeader("Authorization", TOKEN);
        request.addHeader("Origin", ORIGIN);
        return request;
    }

    private MockHttpServletResponse invoke() throws Exception {
        var response = new MockHttpServletResponse();
        filter.doFilter(request(), response, product);
        return response;
    }

    private void assertRejected(MockHttpServletResponse response, int status, String error) throws Exception {
        assertThat(response.getStatus()).isEqualTo(status);
        assertThat(response.getContentType()).isEqualTo("application/json");
        assertThat(json.readTree(response.getContentAsString())).isEqualTo(json.readTree("{\"error\":\"" + error + "\"}"));
        assertThat(response.getErrorMessage()).isNull();
        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        verifyNoInteractions(db, product);
    }

    @Test
    void quotaExhaustionReturnsJson429AndDelayBeforeAnyProductWork() throws Exception {
        upstreamStatus = 429;
        upstreamBody = "{\"error\":\"PRIVATE_PROVIDER_DETAILS\"}";
        retryAfter = "17";
        var response = invoke();
        assertRejected(response, 429, "RATE_LIMITED");
        assertThat(response.getHeader("Retry-After")).isEqualTo("17");
        assertThat(authCalls.get()).isEqualTo(1);
    }

    @Test
    void onlyCanonicalBoundedQuotaDelaysAreForwarded() throws Exception {
        upstreamStatus = 429;
        for (String value : new String[] { null, "0", "-1", "61", "9999999999", "01", "1.5", "Fri, 01 Jan 2038 00:00:00 GMT" }) {
            retryAfter = value;
            var response = invoke();
            assertRejected(response, 429, "RATE_LIMITED");
            assertThat(response.getHeader("Retry-After")).as("retry-after %s", value).isNull();
        }
    }

    @Test
    void invalidCredentialsAndUpstreamFailuresStayGenericAndNeverReachTheProduct() throws Exception {
        upstreamBody = "{\"error\":\"PRIVATE_PROVIDER_DETAILS\"}";
        retryAfter = "12";
        for (int status : new int[] { 401, 403, 400, 500, 503 }) {
            upstreamStatus = status;
            var response = invoke();
            assertRejected(response, status == 401 || status == 403 ? 401 : 503,
                    status == 401 || status == 403 ? "LOGIN_REQUIRED" : "AUTH_SERVICE_UNAVAILABLE");
            assertThat(response.getHeader("Retry-After")).isNull();
        }
        upstreamStatus = 200;
        upstreamBody = "{\"network\":\"mainnet\",\"address\":\"" + ADDRESS + "\"}";
        assertRejected(invoke(), 401, "LOGIN_REQUIRED");
        upstreamBody = "not-json: PRIVATE_PROVIDER_DETAILS";
        assertRejected(invoke(), 503, "AUTH_SERVICE_UNAVAILABLE");
        server.stop(0);
        assertRejected(invoke(), 503, "AUTH_SERVICE_UNAVAILABLE");
    }

    @Test
    void missingCredentialsFailWithoutCallingAuth() throws Exception {
        var response = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest("GET", "/api/me"), response, product);
        assertRejected(response, 401, "LOGIN_REQUIRED");
        assertThat(authCalls.get()).isZero();
    }

    @Test
    void verifiedIdentityStillReachesProductWithTheServerResolvedUser() throws Exception {
        when(db.query(anyString(), org.mockito.ArgumentMatchers.<RowMapper<Long>>any(), eq(ADDRESS))).thenReturn(List.of(7L));
        var request = request();
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, product);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(SecurityContextHolder.getContext().getAuthentication().getPrincipal()).isEqualTo(7L);
        verify(product).doFilter(request, response);
    }
}
