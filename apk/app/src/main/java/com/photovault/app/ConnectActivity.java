package com.photovault.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;

import java.io.IOException;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class ConnectActivity extends AppCompatActivity {

    private EditText etServerUrl;
    private EditText etUsername;
    private EditText etPassword;
    private Button btnConnect;
    private ProgressBar progressBar;
    private TextView tvError;

    private SharedPreferences prefs;
    private final OkHttpClient httpClient = new OkHttpClient();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        prefs = getSharedPreferences("photovault_prefs", Context.MODE_PRIVATE);

        // Check if already authenticated
        String savedToken = prefs.getString("auth_token", null);
        String savedUrl = prefs.getString("server_url", null);
        if (savedToken != null && !savedToken.isEmpty() && savedUrl != null && !savedUrl.isEmpty()) {
            launchMainActivity(savedUrl);
            return;
        }

        setContentView(R.layout.activity_connect);

        etServerUrl = findViewById(R.id.etServerUrl);
        etUsername = findViewById(R.id.etUsername);
        etPassword = findViewById(R.id.etPassword);
        btnConnect = findViewById(R.id.btnConnect);
        progressBar = findViewById(R.id.progressBar);
        tvError = findViewById(R.id.tvError);

        // Pre-fill last used server URL if exists
        if (savedUrl != null && !savedUrl.isEmpty()) {
            etServerUrl.setText(savedUrl);
        }

        btnConnect.setOnClickListener(v -> attemptLogin());
    }

    private void attemptLogin() {
        hideError();

        String rawUrl = etServerUrl.getText().toString().trim();
        String username = etUsername.getText().toString().trim();
        String password = etPassword.getText().toString().trim();

        if (rawUrl.isEmpty() || username.isEmpty() || password.isEmpty()) {
            showError(getString(R.string.fill_all_fields));
            return;
        }

        // Normalize URL
        String serverUrl = rawUrl;
        if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
            serverUrl = "http://" + serverUrl;
        }
        if (serverUrl.endsWith("/")) {
            serverUrl = serverUrl.substring(0, serverUrl.length() - 1);
        }

        setLoading(true);

        try {
            JSONObject json = new JSONObject();
            json.put("username", username);
            json.put("password", password);

            MediaType JSON = MediaType.parse("application/json; charset=utf-8");
            RequestBody body = RequestBody.create(json.toString(), JSON);

            Request request = new Request.Builder()
                    .url(serverUrl + "/api/auth/login")
                    .post(body)
                    .build();

            final String finalServerUrl = serverUrl;

            httpClient.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    mainHandler.post(() -> {
                        setLoading(false);
                        showError("Não foi possível alcançar o servidor (" + e.getMessage() + "). Verifique o IP, porta e sua rede Wi-Fi.");
                    });
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    final String respBody = response.body() != null ? response.body().string() : "";

                    mainHandler.post(() -> {
                        setLoading(false);
                        try {
                            if (response.isSuccessful()) {
                                JSONObject resJson = new JSONObject(respBody);
                                String token = resJson.optString("token", "");
                                JSONObject userObj = resJson.optJSONObject("user");

                                if (!token.isEmpty()) {
                                    // Save credentials to SharedPreferences
                                    prefs.edit()
                                            .putString("server_url", finalServerUrl)
                                            .putString("auth_token", token)
                                            .putString("user_data", userObj != null ? userObj.toString() : "")
                                            .apply();

                                    Toast.makeText(ConnectActivity.this, "Conectado com sucesso!", Toast.LENGTH_SHORT).show();
                                    launchMainActivity(finalServerUrl);
                                } else {
                                    showError("Resposta inválida do servidor: token ausente.");
                                }
                            } else {
                                try {
                                    JSONObject errJson = new JSONObject(respBody);
                                    String msg = errJson.optString("error", "Falha na autenticação (" + response.code() + ")");
                                    showError(msg);
                                } catch (Exception e) {
                                    showError("Falha na autenticação (código " + response.code() + ").");
                                }
                            }
                        } catch (Exception ex) {
                            showError("Erro ao processar dados: " + ex.getMessage());
                        }
                    });
                }
            });

        } catch (Exception e) {
            setLoading(false);
            showError("Erro: " + e.getMessage());
        }
    }

    private void launchMainActivity(String serverUrl) {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("SERVER_URL", serverUrl);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    private void setLoading(boolean loading) {
        btnConnect.setEnabled(!loading);
        progressBar.setVisibility(loading ? View.VISIBLE : View.GONE);
        etServerUrl.setEnabled(!loading);
        etUsername.setEnabled(!loading);
        etPassword.setEnabled(!loading);
    }

    private void showError(String message) {
        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }

    private void hideError() {
        tvError.setVisibility(View.GONE);
    }
}
