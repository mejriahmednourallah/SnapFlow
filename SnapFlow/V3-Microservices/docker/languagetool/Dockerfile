# Reuse the already pinned, offline CPU linguistic assets. No new model downloads.
FROM snapflow/v3-python-nlp-base:latest
WORKDIR /opt/languagetool/LanguageTool-6.8
COPY server.properties /etc/languagetool.properties
EXPOSE 8086
ENV JAVA_TOOL_OPTIONS=-Xmx768m
CMD ["java", "-cp", "languagetool-server.jar", "org.languagetool.server.HTTPServer", "--port", "8086", "--public", "--config", "/etc/languagetool.properties"]
