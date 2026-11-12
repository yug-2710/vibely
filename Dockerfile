FROM eclipse-temurin:21-jdk
WORKDIR /app

# MySQL driver (Main.java needs it to talk to the database)
ADD https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.4.0/mysql-connector-j-8.4.0.jar /app/mysql-connector-j.jar

COPY Main.java .
COPY web ./web

RUN javac -encoding UTF-8 Main.java

# Render sets PORT automatically; Main.java reads it
ENV BIND_HOST=0.0.0.0
CMD ["java", "-cp", ".:mysql-connector-j.jar", "Main"]
