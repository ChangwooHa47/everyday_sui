package com.everyday.backend.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.filter.OncePerRequestFilter;

/** The verified wallet address is resolved server-side; caller-supplied user IDs are never trusted. */
@Component
@Profile("!baseline")
public class WalletAuthenticationFilter extends OncePerRequestFilter {
    private final RestClient auth;
    private final JdbcTemplate db;

    public WalletAuthenticationFilter(@Value("${app.wallet.auth-url}") String authUrl, JdbcTemplate db) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        this.auth = RestClient.builder().baseUrl(authUrl).requestFactory(factory).build();
        this.db = db;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (request.getRequestURI().startsWith("/health/") || request.getMethod().equals("OPTIONS")) {
            chain.doFilter(request, response); return;
        }
        String token = request.getHeader("Authorization"), origin = request.getHeader("Origin");
        if (token == null || !token.matches("Bearer [A-Za-z0-9_-]{43}") || origin == null) {
            response.sendError(401); return;
        }
        try {
            Map<?, ?> identity = auth.get().uri("/v1/me").header("Authorization", token).header("Origin", origin)
                    .retrieve().body(Map.class);
            if (identity == null || !"testnet".equals(identity.get("network"))
                    || !(identity.get("address") instanceof String address) || !address.matches("0x[0-9a-f]{64}")) {
                response.sendError(401); return;
            }
            List<Long> existing = db.query("SELECT id FROM everyday.users WHERE wallet_address=?", (row, n) -> row.getLong(1), address);
            if (existing.isEmpty()) {
                db.update("""
                        INSERT INTO everyday.users(wallet_address,points,version,created_at,updated_at)
                        VALUES (?,1200,0,now(),now()) ON CONFLICT(wallet_address) DO NOTHING
                        """, address);
                existing = db.query("SELECT id FROM everyday.users WHERE wallet_address=?", (row, n) -> row.getLong(1), address);
            }
            Long userId = existing.getFirst();
            SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(
                    userId, null, List.of(new SimpleGrantedAuthority("ROLE_USER"))));
        } catch (HttpClientErrorException e) {
            response.sendError(e.getStatusCode().value() == 401 || e.getStatusCode().value() == 403 ? 401 : 503); return;
        } catch (Exception e) {
            response.sendError(503); return;
        }
        chain.doFilter(request, response);
    }
}
