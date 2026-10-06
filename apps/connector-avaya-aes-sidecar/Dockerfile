# Build with the Avaya SDK jars mounted in ./lib (never committed):
#   docker build --build-arg JTAPI=lib/ecsjtapia.jar -t verbis/avaya-sidecar .
FROM gradle:8.14-jdk21 AS build
ARG JTAPI=""
WORKDIR /src
COPY . .
RUN ARGS=""; [ -n "$JTAPI" ] && ARGS="$ARGS -Pavaya.jtapi=/src/$JTAPI"; gradle --no-daemon bootJar $ARGS

FROM eclipse-temurin:21-jre-alpine
RUN apk upgrade --no-cache
RUN addgroup -S -g 10001 verbis && adduser -S -u 10001 verbis -G verbis
USER 10001:10001
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 CMD-SHELL wget -q -O- http://127.0.0.1:8086/actuator/health >/dev/null || exit 1
WORKDIR /app
COPY --from=build --chown=10001:10001 /src/build/libs/*.jar app.jar
EXPOSE 8086
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar"]
