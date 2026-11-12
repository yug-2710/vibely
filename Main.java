import com.sun.net.httpserver.*;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.stream.ImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.*;
import java.net.*;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.sql.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Vibely backend: serves web/, JSON API under /api/, users stored in MySQL. */
public class Main {

    // ---- Settings: ALL secrets come from environment variables. Nothing secret is stored in this file. ----
    //   DB_USER      (required)  MySQL user dedicated to the vibely database (NOT root)
    //   DB_PASSWORD  (required)  that user's password
    //   DB_URL       (optional)  defaults to MySQL on the same machine. If MySQL is on another server use
    //                            jdbc:mysql://DB_HOST:3306/vibely?useSSL=true&requireSSL=true&serverTimezone=UTC
    //   YT_API_KEY   (optional)  YouTube Data API key. If missing, music search shows "not set up"; the rest works.
    static final String DB_URL  = env("DB_URL",
            "jdbc:mysql://localhost:3306/vibely?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC");
    static final String DB_USER = required("DB_USER");
    static final String DB_PASS = required("DB_PASSWORD");
    // Stays on the server and is never sent to the browser.
    static final String YT_API_KEY = env("YT_API_KEY", "");

    static final Path WEB_ROOT = Paths.get("web").toAbsolutePath().normalize();
    static final Path UPLOAD_ROOT = WEB_ROOT.resolve("uploads");
    static final int MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB, decoded
    static final int MAX_IMAGE_PIXELS = 16_000_000;     // ~16 megapixels, checked before the image is decoded
    // Request body caps. Normal API calls are tiny; only the three endpoints that take a photo get the big cap
    // (5 MB image -> ~6.7 MB base64 -> a bit more once form-encoded).
    static final int MAX_BODY_BYTES = 64 * 1024;
    static final int MAX_IMAGE_BODY_BYTES = 10 * 1024 * 1024;
    static final String JSON = "application/json";
    static final String COLS = "username, role, gender, name, detail, bio, course, year_of_study, interests, security_question, avatar_path, onboarded";

    static final String[] QUESTIONS = {
        "What was the name of your first pet?", "What is your mother's maiden name?",
        "What was your first school called?", "What is your favourite teacher's name?",
        "In which city were you born?"
    };

    // Hostels a student can pick, by gender (keep in sync with HOSTELS in web/script.js)
    static final String[] GIRLS_HOSTELS = {"Ivory Hall", "Rosewood Hall", "New Hostel D"};
    static final String[] BOYS_HOSTELS = {"Chanakya Hostel", "Einstein Hostel", "Tagore Hostel",
                                          "Sadbhavna Hostel", "Sukhmani", "City Hostel"};

    static boolean validHostel(String gender, String hostel) {
        String[] list = gender.equals("female") ? GIRLS_HOSTELS : gender.equals("male") ? BOYS_HOSTELS : new String[0];
        return Arrays.asList(list).contains(hostel);
    }

    /** One logged-in session. lastSeen is bumped on every authenticated request (sliding idle timeout). */
    static final class Session {
        volatile String user;
        final long created;
        volatile long lastSeen;
        Session(String user, long now) { this.user = user; this.created = now; this.lastSeen = now; }
    }
    /** Logged-in sessions: token -> session (kept in memory, cleared when the server restarts). */
    static final Map<String, Session> SESSIONS = new ConcurrentHashMap<>();
    /** A session dies after 7 days without use, or 30 days after login no matter what. */
    static final long SESSION_IDLE_MS = 7L * 24 * 60 * 60 * 1000;
    static final long SESSION_MAX_MS = 30L * 24 * 60 * 60 * 1000;

    /** Returns the username for a valid, unexpired token (and refreshes its idle timer); otherwise null. */
    static String sessionUser(String token) {
        if (token == null) return null;
        Session s = SESSIONS.get(token);
        if (s == null) return null;
        long now = System.currentTimeMillis();
        if (now - s.created > SESSION_MAX_MS || now - s.lastSeen > SESSION_IDLE_MS) {
            SESSIONS.remove(token, s);
            return null;
        }
        s.lastSeen = now;
        return s.user;
    }

    static void purgeExpiredSessions() {
        long now = System.currentTimeMillis();
        SESSIONS.values().removeIf(s -> now - s.created > SESSION_MAX_MS || now - s.lastSeen > SESSION_IDLE_MS);
    }
    /** Wrong security answers: key -> {count, windowStartMs}. Time-based, so a lockout expires after 15 minutes. */
    static final long RESET_WINDOW_MS = 15 * 60 * 1000L;
    static final int RESET_MAX_PER_USER = 5, RESET_MAX_PER_IP = 20;
    static final Map<String, long[]> RESET_FAILS = new ConcurrentHashMap<>();

    interface Action { void run(HttpExchange ex, Map<String, String> f, String user) throws Exception; }

    static String env(String key, String fallback) {
        String v = System.getenv(key);
        return (v == null || v.isEmpty()) ? fallback : v;
    }

    /** A setting with no safe default (a secret). Stops the server with a clear message instead of using a guess. */
    static String required(String key) {
        String v = System.getenv(key);
        if (v == null || v.isEmpty()) {
            System.err.println("FATAL: environment variable " + key + " is not set. Set it and start again "
                    + "(see the systemd service / env file). Secrets are no longer stored in the code.");
            System.exit(1);
        }
        return v;
    }

    static Connection db() throws SQLException {
        Connection c = DriverManager.getConnection(DB_URL, DB_USER, DB_PASS);
        // Every connection talks UTC, whatever time zone the MySQL server or the machine is set to. Timestamps go out
        // as ISO strings ending in "Z" (see DATE_FORMAT below) and the browser shows them in the viewer's own zone.
        // If you move to a connection pool, put this statement in its connection-init setting instead.
        try (Statement st = c.createStatement()) {
            st.execute("SET time_zone = '+00:00'");
        } catch (SQLException e) {
            c.close();
            throw e;
        }
        return c;
    }

    /** Step 13: if MySQL runs on another machine, the link must be encrypted (passwords and chat text cross it). */
    static void warnIfDbUnencrypted() {
        String u = DB_URL.toLowerCase();
        boolean local = u.matches("jdbc:mysql://(localhost|127\\.0\\.0\\.1|\\[::1\\])([:/?].*)?");
        boolean encrypted = u.contains("usessl=true") || u.matches(".*sslmode=(required|verify_ca|verify_identity).*");
        if (!local && !encrypted) {
            System.err.println("WARNING: DB_URL points to another machine but SSL is not enabled. Add useSSL=true&requireSSL=true "
                    + "(or sslMode=REQUIRED) to DB_URL so database traffic is encrypted.");
        }
    }

    // ---------------- Image uploads (profile pictures, post photos, lost&found photos) ----------------
    // The client sends a "data:image/...;base64,..." string as a normal form field (see web/script.js,
    // fileToCompressedDataUrl). We decode it here and write it under web/uploads/<folder>/, so the
    // existing static file server can serve it straight back out at /uploads/<folder>/<file>.
    static final Pattern DATA_URL = Pattern.compile("^data:image/(png|jpe?g|webp|gif);base64,(.+)$", Pattern.DOTALL);

    /** Decodes and saves a "data:image/..." string under web/uploads/<folder>/. Returns the relative
     *  web path (e.g. "uploads/avatars/xxxx.jpg"), or null if dataUrl is blank.
     *  Throws IllegalArgumentException (caller should turn this into a 400) if the image is invalid or too big. */
    static String saveImage(String dataUrl, String folder) throws IOException {
        if (dataUrl == null || dataUrl.isEmpty()) return null;
        Matcher m = DATA_URL.matcher(dataUrl);
        if (!m.matches()) throw new IllegalArgumentException("That doesn't look like an image file.");
        String b64 = m.group(2);
        if (b64.length() > (long) MAX_IMAGE_BYTES * 4 / 3 + 16) throw new IllegalArgumentException("Images must be under 5 MB.");
        byte[] bytes;
        try {
            bytes = Base64.getDecoder().decode(b64);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("That image couldn't be read.");
        }
        if (bytes.length > MAX_IMAGE_BYTES) throw new IllegalArgumentException("Images must be under 5 MB.");
        // Decode for real and re-encode: proves it is an image, caps its size, and strips EXIF/GPS and any hidden payload.
        bytes = sanitizeImage(bytes);
        Path dir = UPLOAD_ROOT.resolve(folder);
        Files.createDirectories(dir);
        String filename = UUID.randomUUID() + ".jpg";
        Files.write(dir.resolve(filename), bytes);
        return "uploads/" + folder + "/" + filename;
    }

    /** Decodes the bytes with ImageIO (checking the dimensions BEFORE the pixels are decoded, so a tiny file that
     *  expands to a huge bitmap is refused) and returns a fresh JPEG. Throws IllegalArgumentException if it isn't a valid image. */
    static byte[] sanitizeImage(byte[] bytes) {
        try (ImageInputStream iis = ImageIO.createImageInputStream(new ByteArrayInputStream(bytes))) {
            Iterator<ImageReader> readers = iis == null ? null : ImageIO.getImageReaders(iis);
            if (readers == null || !readers.hasNext()) throw new IllegalArgumentException("That doesn't look like a valid image (use JPG, PNG or GIF).");
            ImageReader reader = readers.next();
            BufferedImage src;
            try {
                reader.setInput(iis, true, true);
                int w = reader.getWidth(0), h = reader.getHeight(0);
                if (w < 1 || h < 1 || (long) w * h > MAX_IMAGE_PIXELS) throw new IllegalArgumentException("That image is too large. Try a smaller one.");
                src = reader.read(0);
            } finally {
                reader.dispose();
            }
            if (src == null) throw new IllegalArgumentException("That image couldn't be read.");
            BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_RGB);
            Graphics2D g = out.createGraphics();
            try {
                g.setColor(Color.WHITE);
                g.fillRect(0, 0, out.getWidth(), out.getHeight());
                g.drawImage(src, 0, 0, null);
            } finally {
                g.dispose();
            }
            ImageWriter writer = ImageIO.getImageWritersByFormatName("jpeg").next();
            try {
                ImageWriteParam param = writer.getDefaultWriteParam();
                param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
                param.setCompressionQuality(0.85f);
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                try (MemoryCacheImageOutputStream ios = new MemoryCacheImageOutputStream(bos)) {
                    writer.setOutput(ios);
                    writer.write(null, new IIOImage(out, null, null), param);
                }
                return bos.toByteArray();
            } finally {
                writer.dispose();
            }
        } catch (IllegalArgumentException e) {
            throw e;
        } catch (IOException | RuntimeException | OutOfMemoryError e) {
            throw new IllegalArgumentException("That image couldn't be read.");
        }
    }

    /** Best-effort delete of a previously-saved upload; ignores anything outside web/uploads/ or missing files. */
    static void deleteImage(String relativePath) {
        if (relativePath == null || relativePath.isEmpty()) return;
        try {
            Path p = WEB_ROOT.resolve(relativePath).normalize();
            if (p.startsWith(UPLOAD_ROOT)) Files.deleteIfExists(p);
        } catch (IOException ignored) {}
    }

    public static void main(String[] args) throws IOException {
        System.setProperty("java.awt.headless", "true");   // image checks run on a server with no screen
        warnIfDbUnencrypted();
        try (Connection c = db()) {
            System.out.println("Connected to MySQL " + c.getMetaData().getDatabaseProductVersion() + ".");
        } catch (SQLException e) {
            System.err.println("Could not connect to MySQL: " + e.getMessage());
            System.err.println("Check that MySQL is running, that you ran schema.sql, and that DB_USER / DB_PASS are correct.");
            return;
        }
        migrate();
        // Every 5 seconds: delete music groups whose leader didn't join in time, and remove members who left the page.
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "music-expiry"); t.setDaemon(true); return t;
        }).scheduleAtFixedRate(() -> {
            try (Connection c = db()) { purgeExpiredMusic(c); }
            catch (Exception e) { System.err.println("Music cleanup warning: " + e.getMessage()); }
        }, 0, 5, java.util.concurrent.TimeUnit.SECONDS);
        // Every 10 minutes: drop expired sessions so the map doesn't grow forever.
        java.util.concurrent.Executors.newSingleThreadScheduledExecutor(r -> {
            Thread t = new Thread(r, "session-expiry"); t.setDaemon(true); return t;
        }).scheduleAtFixedRate(Main::purgeExpiredSessions, 10, 10, java.util.concurrent.TimeUnit.MINUTES);
        Files.createDirectories(UPLOAD_ROOT);
        // PORT and BIND_HOST come from the environment so the same build runs locally and on a server.
        // Behind a reverse proxy (Caddy/nginx) set BIND_HOST=127.0.0.1 so only the proxy can reach the app.
        int port;
        try { port = Integer.parseInt(env("PORT", "8080")); }
        catch (NumberFormatException e) { throw new IllegalStateException("PORT must be a number"); }
        String bindHost = env("BIND_HOST", "0.0.0.0");
        HttpServer server = HttpServer.create(new InetSocketAddress(bindHost, port), 0);
        // Handle requests on a pool of threads. Without this, HttpServer uses ONE thread, so a single slow request
        // (e.g. a login hashing the password) makes every other user wait. Shared state above is in ConcurrentHashMaps.
        int threads;
        try { threads = Math.max(2, Integer.parseInt(env("HTTP_THREADS", "16"))); }
        catch (NumberFormatException e) { threads = 16; }
        server.setExecutor(java.util.concurrent.Executors.newFixedThreadPool(threads, new java.util.concurrent.ThreadFactory() {
            private final java.util.concurrent.atomic.AtomicInteger n = new java.util.concurrent.atomic.AtomicInteger();
            public Thread newThread(Runnable r) { Thread t = new Thread(r, "http-" + n.incrementAndGet()); t.setDaemon(false); return t; }
        }));
        server.createContext("/api/register", post(false, Main::register));
        server.createContext("/api/login", post(false, Main::login));
        server.createContext("/api/logout", post(true, Main::logout));
        server.createContext("/api/me", post(true, Main::me));
        server.createContext("/api/profile", post(true, MAX_IMAGE_BODY_BYTES, Main::updateProfile));
        server.createContext("/api/onboarded", post(true, Main::markOnboarded));
        server.createContext("/api/username", post(true, Main::changeUsername));
        server.createContext("/api/password", post(true, Main::changePassword));
        server.createContext("/api/security", post(true, Main::setSecurity));
        server.createContext("/api/people", post(true, Main::people));
        server.createContext("/api/search", post(true, Main::search));

        server.createContext("/api/follow", post(true, Main::followToggle));
        server.createContext("/api/connections", post(true, Main::connections));
        server.createContext("/api/userprofile", post(true, Main::userProfile));

        server.createContext("/api/posts/create", post(true, MAX_IMAGE_BODY_BYTES, Main::postsCreate));
        server.createContext("/api/posts/list", post(true, Main::postsList));
        server.createContext("/api/posts/like", post(true, Main::postsLike));
        server.createContext("/api/posts/comment", post(true, Main::postsComment));
        server.createContext("/api/posts/comments", post(true, Main::postsComments));
        server.createContext("/api/posts/delete", post(true, Main::postsDelete));

        server.createContext("/api/events/create", post(true, Main::eventsCreate));
        server.createContext("/api/events/list", post(true, Main::eventsList));
        server.createContext("/api/events/rsvp", post(true, Main::eventsRsvp));
        server.createContext("/api/events/like", post(true, Main::eventsLike));
        server.createContext("/api/events/comment", post(true, Main::eventsComment));
        server.createContext("/api/events/comments", post(true, Main::eventsComments));
        server.createContext("/api/events/delete", post(true, Main::eventsDelete));

        server.createContext("/api/groups/create", post(true, Main::groupsCreate));
        server.createContext("/api/groups/list", post(true, Main::groupsList));
        server.createContext("/api/groups/get", post(true, Main::groupsGet));
        server.createContext("/api/groups/request", post(true, Main::groupsRequest));
        server.createContext("/api/groups/requests", post(true, Main::groupsRequests));
        server.createContext("/api/groups/respond", post(true, Main::groupsRespond));
        server.createContext("/api/groups/leave", post(true, Main::groupsLeave));
        server.createContext("/api/groups/members", post(true, Main::groupsMembers));
        server.createContext("/api/groups/promote", post(true, Main::groupsPromote));
        server.createContext("/api/groups/remove", post(true, Main::groupsRemove));
        server.createContext("/api/groups/delete", post(true, Main::groupsDelete));
        server.createContext("/api/groups/chat/list", post(true, Main::groupChatList));
        server.createContext("/api/groups/chat/send", post(true, Main::groupChatSend));
        server.createContext("/api/groups/chat/delete", post(true, Main::groupChatDelete));

        server.createContext("/api/music/create", post(true, Main::musicCreate));
        server.createContext("/api/music/list", post(true, Main::musicList));
        server.createContext("/api/music/join", post(true, Main::musicJoin));
        server.createContext("/api/music/leave", post(true, Main::musicLeave));
        server.createContext("/api/music/away", post(true, Main::musicAway));
        server.createContext("/api/music/ping", post(true, Main::musicPing));
        server.createContext("/api/music/state", post(true, Main::musicState));
        server.createContext("/api/music/control", post(true, Main::musicControl));
        server.createContext("/api/music/search", post(true, Main::musicSearch));
        server.createContext("/api/music/transfer", post(true, Main::musicTransfer));
        server.createContext("/api/music/delete", post(true, Main::musicDelete));

        server.createContext("/api/lostfound/create", post(true, MAX_IMAGE_BODY_BYTES, Main::lostFoundCreate));
        server.createContext("/api/lostfound/list", post(true, Main::lostFoundList));
        server.createContext("/api/lostfound/resolve", post(true, Main::lostFoundResolve));
        server.createContext("/api/lostfound/delete", post(true, Main::lostFoundDelete));

        server.createContext("/api/rides/create", post(true, Main::ridesCreate));
        server.createContext("/api/rides/list", post(true, Main::ridesList));
        server.createContext("/api/rides/request", post(true, Main::ridesRequest));
        server.createContext("/api/rides/respond", post(true, Main::ridesRespond));
        server.createContext("/api/rides/requests", post(true, Main::ridesRequests));
        server.createContext("/api/rides/close", post(true, Main::ridesClose));
        server.createContext("/api/rides/delete", post(true, Main::ridesDelete));

        server.createContext("/api/notifications/list", post(true, Main::notificationsList));
        server.createContext("/api/notifications/read", post(true, Main::notificationsRead));

        server.createContext("/api/messages/send", post(true, Main::messagesSend));
        server.createContext("/api/messages/conversations", post(true, Main::messagesConversations));
        server.createContext("/api/messages/thread", post(true, Main::messagesThread));
        server.createContext("/api/messages/unread", post(true, Main::messagesUnread));
        server.createContext("/api/messages/unsend", post(true, Main::messagesUnsend));
        server.createContext("/api/messages/edit", post(true, Main::messagesEdit));
        server.createContext("/api/messages/delete", post(true, Main::messagesDelete));
        server.createContext("/api/messages/clear", post(true, Main::messagesClear));

        server.createContext("/api/forgot/question", post(false, Main::forgotQuestion));
        server.createContext("/api/forgot/reset", post(false, Main::forgotReset));
        server.createContext("/", Main::handleStatic);
        server.start();
        System.out.println("Vibely listening on " + bindHost + ":" + port);
    }


    // ---------------- Startup migration (safe to run every time) ----------------
    /** Adds users.onboarded and makes sure notifications can hold "mention" / "group" values. */
    static void migrate() {
        try (Connection c = db()) {
            boolean has;
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    + "AND TABLE_NAME = 'users' AND COLUMN_NAME = 'onboarded'");
                 ResultSet rs = ps.executeQuery()) { has = rs.next(); }
            if (!has) {
                try (Statement st = c.createStatement()) {
                    st.executeUpdate("ALTER TABLE users ADD COLUMN onboarded TINYINT(1) NOT NULL DEFAULT 0");
                }
                System.out.println("Migration: added users.onboarded (existing accounts will see the welcome page once).");
            }
            createMusicTables(c);
            widenEnum(c, "notifications", "type", "mention", "VARCHAR(30) NOT NULL");
            widenEnum(c, "notifications", "target_type", "group", "VARCHAR(30) NULL");
        } catch (SQLException e) {
            System.err.println("Migration warning: " + e.getMessage());
        }
    }

    /** If table.column is an ENUM that lacks the needed value, turn it into a plain VARCHAR. */
    static void widenEnum(Connection c, String table, String column, String needed, String newDefinition) throws SQLException {
        String type = null;
        try (PreparedStatement ps = c.prepareStatement("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                + "AND TABLE_NAME = ? AND COLUMN_NAME = ?")) {
            ps.setString(1, table); ps.setString(2, column);
            try (ResultSet rs = ps.executeQuery()) { if (rs.next()) type = rs.getString(1); }
        }
        if (type == null) return;
        String t = type.toLowerCase();
        if (t.startsWith("enum(") && !t.contains("'" + needed + "'")) {
            try (Statement st = c.createStatement()) {
                st.executeUpdate("ALTER TABLE " + table + " MODIFY " + column + " " + newDefinition);
            }
            System.out.println("Migration: " + table + "." + column + " no longer an ENUM (needed '" + needed + "').");
        }
    }

    static void markOnboarded(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement("UPDATE users SET onboarded = 1 WHERE username = ?")) {
            ps.setString(1, user);
            ps.executeUpdate();
        }
        okMsg(ex, "All set.");
    }

    /** Wraps an API action: POST only, reads the form, checks the login token if required. */
    static HttpHandler post(boolean needsLogin, Action action) { return post(needsLogin, MAX_BODY_BYTES, action); }

    /** Reads at most maxBytes of the request body; returns null if it is larger (or Content-Length is bogus). */
    static byte[] readBody(HttpExchange ex, int maxBytes) throws IOException {
        String cl = ex.getRequestHeaders().getFirst("Content-Length");
        if (cl != null) {
            try {
                long n = Long.parseLong(cl.trim());
                if (n < 0 || n > maxBytes) return null;
            } catch (NumberFormatException e) { return null; }
        }
        try (InputStream in = ex.getRequestBody()) {
            byte[] data = in.readNBytes(maxBytes + 1);   // also covers chunked bodies that send no Content-Length
            return data.length > maxBytes ? null : data;
        }
    }

    static HttpHandler post(boolean needsLogin, int maxBody, Action action) {
        return ex -> {
            try {
                if (!ex.getRequestMethod().equalsIgnoreCase("POST")) { fail(ex, 405, "Use POST"); return; }
                byte[] body = readBody(ex, maxBody);
                if (body == null) { fail(ex, 413, "That request is too large."); return; }
                Map<String, String> form = parseForm(new String(body, StandardCharsets.UTF_8));
                String t = token(ex);
                String user = sessionUser(t);
                if (needsLogin && user == null) { expired(ex); return; }
                action.run(ex, form, user);
            } catch (SQLException e) {
                e.printStackTrace();
                fail(ex, 500, "Database error. Check the server console.");
            } catch (Exception e) {
                e.printStackTrace();
                fail(ex, 500, "Something went wrong. Check the server console.");
            }
        };
    }

    static String token(HttpExchange ex) {
        String h = ex.getRequestHeaders().getFirst("Authorization");
        return (h != null && h.startsWith("Bearer ")) ? h.substring(7) : null;
    }

    // ---------------- Username rules (same as Instagram) ----------------
    // 1-30 characters; letters, numbers, periods, underscores; can't start or end
    // with a period; no two periods in a row; not case-sensitive (stored lowercase).
    static String usernameError(String u) {
        if (u.isEmpty() || u.length() > 30) return "Username must be 1-30 characters.";
        if (!u.matches("[a-z0-9._]+")) return "Usernames can only use letters, numbers, underscores and periods.";
        if (u.startsWith(".") || u.endsWith(".")) return "A username can't start or end with a period.";
        if (u.contains("..")) return "A username can't have two periods in a row.";
        return null;
    }

    /** Question number ("0".."4") -> question text, or null if invalid. */
    static String questionText(String index) {
        try {
            int i = Integer.parseInt(index);
            return (i >= 0 && i < QUESTIONS.length) ? QUESTIONS[i] : null;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    // ---------------- Register / login / logout ----------------
    static void register(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String role = get(f, "role");
        String username = get(f, "username").toLowerCase();
        String name = get(f, "name");
        String gender = get(f, "gender");
        String detail = get(f, "detail");
        String password = f.getOrDefault("password", "");
        String question = questionText(get(f, "question"));
        String answer = get(f, "answer").toLowerCase();

        String error;
        if (!role.equals("hostellor") && !role.equals("dayscholar")) error = "Choose Hostellor or Day scholar.";
        else if (name.isEmpty() || name.length() > 40) error = "Enter your name (up to 40 characters).";
        else if (usernameError(username) != null) error = usernameError(username);
        else if (!gender.equals("female") && !gender.equals("male")) error = "Choose your gender.";
        else if (role.equals("hostellor") && !validHostel(gender, detail)) error = "Choose your hostel from the list.";
        else if (detail.isEmpty() || detail.length() > 60) error = "Fill in the last field (up to 60 characters).";
        else if (password.length() < 6) error = "Password must be at least 6 characters.";
        else if (question == null) error = "Choose a security question.";
        else if (answer.length() < 2 || answer.length() > 60) error = "Security answer must be 2-60 characters.";
        else error = null;
        if (error != null) { fail(ex, 400, error); return; }

        String sql = "INSERT INTO users (username, role, name, detail, password_hash, security_question, security_answer_hash, gender) VALUES (?,?,?,?,?,?,?,?)";
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username); ps.setString(2, role); ps.setString(3, name); ps.setString(4, detail);
            ps.setString(5, hash(password)); ps.setString(6, question); ps.setString(7, hash(answer)); ps.setString(8, gender);
            ps.executeUpdate();
            System.out.println("Registered new " + role + ": " + username);
            okMsg(ex, "Account created.");
        } catch (SQLIntegrityConstraintViolationException e) {
            fail(ex, 400, "That username is taken. Try another one.");
        }
    }

    // ---------------- Login throttling ----------------
    // Counts FAILED logins in a 15-minute window. Three buckets: this username from this IP (8), this IP overall (40),
    // and this username from anywhere (60, high so a stranger can't easily lock someone out). A success clears the first.
    static final long LOGIN_WINDOW_MS = 15 * 60 * 1000L;
    static final Map<String, long[]> LOGIN_FAILS = new ConcurrentHashMap<>();   // key -> {count, windowStartMs}
    static final boolean TRUST_PROXY = "true".equalsIgnoreCase(env("TRUST_PROXY", "false"));
    // Used so a wrong username takes as long to reject as a wrong password (no timing hint about which usernames exist).
    static final String DUMMY_HASH = hash("vibely-timing-dummy");

    // The caller's IP. Behind Caddy/nginx set TRUST_PROXY=true: the proxy appends the real client IP as the LAST
    // X-Forwarded-For entry (earlier entries can be forged by the client, so they are ignored).
    // X-Forwarded-For is only believed when the TCP connection itself comes from this machine (the proxy),
    // so someone who reaches the app port directly can't fake their IP.
    static String clientIp(HttpExchange ex) {
        java.net.InetAddress peer = ex.getRemoteAddress().getAddress();
        if (TRUST_PROXY && (peer.isLoopbackAddress() || peer.isAnyLocalAddress())) {
            List<String> all = ex.getRequestHeaders().get("X-Forwarded-For");   // may be split over several header lines
            if (all != null && !all.isEmpty()) {
                String xff = all.get(all.size() - 1);
                String[] parts = xff.split(",");
                String last = parts[parts.length - 1].trim();
                if (!last.isEmpty() && last.length() <= 64 && last.matches("[0-9A-Fa-f:.%]+")) return last;
            }
        }
        return peer.getHostAddress();
    }

    static boolean loginBlocked(String key, int limit) {
        long[] e = LOGIN_FAILS.get(key);
        return e != null && System.currentTimeMillis() - e[1] < LOGIN_WINDOW_MS && e[0] >= limit;
    }

    static void loginFailed(String key) {
        long now = System.currentTimeMillis();
        LOGIN_FAILS.compute(key, (k, e) -> (e == null || now - e[1] >= LOGIN_WINDOW_MS) ? new long[]{1, now} : new long[]{e[0] + 1, e[1]});
        if (LOGIN_FAILS.size() > 20000) LOGIN_FAILS.entrySet().removeIf(en -> now - en.getValue()[1] >= LOGIN_WINDOW_MS);
    }

    static void login(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String role = get(f, "role");
        String username = get(f, "username").toLowerCase();
        String password = f.getOrDefault("password", "");
        if (username.length() > 60 || password.length() > 200) { fail(ex, 401, "Incorrect username or password."); return; }

        String ip = clientIp(ex);
        String kPair = "up:" + username + "|" + ip, kIp = "ip:" + ip, kUser = "u:" + username;
        if (loginBlocked(kPair, 8) || loginBlocked(kIp, 40) || loginBlocked(kUser, 60)) {
            fail(ex, 429, "Too many failed attempts. Please wait about 15 minutes and try again.");
            return;
        }

        try (Connection c = db();
             PreparedStatement ps = c.prepareStatement("SELECT " + COLS + ", password_hash FROM users WHERE username = ?")) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                boolean found = rs.next();
                // Always do one password check, even for an unknown username, so both cases look and take the same.
                boolean ok = verify(password, found ? rs.getString("password_hash") : DUMMY_HASH) && found;
                if (!ok) {
                    loginFailed(kPair); loginFailed(kIp); loginFailed(kUser);
                    fail(ex, 401, "Incorrect username or password.");
                    return;
                }
                // Only someone who knows the password learns that the account is of the other type.
                if (!rs.getString("role").equals(role)) {
                    fail(ex, 401, "This username belongs to the other login type. Switch the tab above.");
                    return;
                }
                LOGIN_FAILS.remove(kPair);
                String token = newToken();
                SESSIONS.put(token, new Session(username, System.currentTimeMillis()));
                send(ex, 200, JSON, "{\"ok\":true,\"token\":" + js(token) + ",\"user\":" + profileJson(rs) + "}");
            }
        }
    }

    static void logout(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String t = token(ex);
        if (t != null) SESSIONS.remove(t);
        okMsg(ex, "Logged out.");
    }

    // ---------------- Profile ----------------
    static void me(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement("SELECT " + COLS + " FROM users WHERE username = ?")) {
            ps.setString(1, user);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) { expired(ex); return; }
                send(ex, 200, JSON, "{\"ok\":true,\"user\":" + profileJson(rs) + "}");
            }
        }
    }

    static void updateProfile(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String name = get(f, "name"), gender = get(f, "gender"), detail = get(f, "detail"), bio = get(f, "bio");
        String course = get(f, "course"), year = get(f, "year"), interests = get(f, "interests");
        String photo = get(f, "photo");
        boolean removePhoto = get(f, "removePhoto").equals("1");

        String error;
        if (name.isEmpty() || name.length() > 40) error = "Enter your name (up to 40 characters).";
        else if (!gender.equals("female") && !gender.equals("male")) error = "Choose your gender.";
        else if (detail.isEmpty() || detail.length() > 60) error = "Fill in the hostel / commute field (up to 60 characters).";
        else if (bio.length() > 150) error = "Bio can be up to 150 characters.";
        else if (course.length() > 60) error = "Course can be up to 60 characters.";
        else if (year.length() > 20) error = "Year is too long.";
        else if (interests.length() > 120) error = "Interests can be up to 120 characters.";
        else error = null;
        if (error != null) { fail(ex, 400, error); return; }

        try (Connection c = db()) {
            String role = null, oldAvatar = null;
            try (PreparedStatement ps = c.prepareStatement("SELECT role, avatar_path FROM users WHERE username = ?")) {
                ps.setString(1, user);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) { role = rs.getString(1); oldAvatar = rs.getString(2); }
                }
            }
            if ("hostellor".equals(role) && !validHostel(gender, detail)) {
                fail(ex, 400, "Choose your hostel from the list.");
                return;
            }
            // Save the photo only after every other check has passed, so a rejected save leaves no stray file.
            String newAvatarPath;
            try {
                newAvatarPath = photo.isEmpty() ? null : saveImage(photo, "avatars");
            } catch (IllegalArgumentException e) {
                fail(ex, 400, e.getMessage());
                return;
            }
            if (newAvatarPath != null || removePhoto) {
                String finalAvatar = newAvatarPath != null ? newAvatarPath : null;
                String sql = "UPDATE users SET name = ?, gender = ?, detail = ?, bio = ?, course = ?, year_of_study = ?, interests = ?, avatar_path = ? WHERE username = ?";
                try (PreparedStatement ps = c.prepareStatement(sql)) {
                    ps.setString(1, name); ps.setString(2, gender); ps.setString(3, detail); ps.setString(4, bio);
                    ps.setString(5, course); ps.setString(6, year); ps.setString(7, interests);
                    ps.setString(8, finalAvatar); ps.setString(9, user);
                    ps.executeUpdate();
                }
                deleteImage(oldAvatar);
            } else {
                String sql = "UPDATE users SET name = ?, gender = ?, detail = ?, bio = ?, course = ?, year_of_study = ?, interests = ? WHERE username = ?";
                try (PreparedStatement ps = c.prepareStatement(sql)) {
                    ps.setString(1, name); ps.setString(2, gender); ps.setString(3, detail); ps.setString(4, bio);
                    ps.setString(5, course); ps.setString(6, year); ps.setString(7, interests); ps.setString(8, user);
                    ps.executeUpdate();
                }
            }
        }
        okMsg(ex, "Details saved.");
    }

    static void changeUsername(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String next = get(f, "newUsername").toLowerCase();
        String err = usernameError(next);
        if (err != null) { fail(ex, 400, err); return; }
        if (next.equals(user)) { fail(ex, 400, "That is already your username."); return; }

        try (Connection c = db()) {
            if (!passwordOk(c, user, f.getOrDefault("password", ""))) { fail(ex, 400, "Current password is wrong."); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE users SET username = ? WHERE username = ?")) {
                ps.setString(1, next); ps.setString(2, user);
                ps.executeUpdate();
            } catch (SQLIntegrityConstraintViolationException e) {
                fail(ex, 400, "That username is taken. Try another one.");
                return;
            }
        }
        SESSIONS.values().forEach(s -> { if (s.user.equals(user)) s.user = next; });
        send(ex, 200, JSON, "{\"ok\":true,\"message\":\"Username changed.\",\"username\":" + js(next) + "}");
    }

    static void changePassword(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String next = f.getOrDefault("newPassword", "");
        if (next.length() < 6) { fail(ex, 400, "New password must be at least 6 characters."); return; }
        try (Connection c = db()) {
            if (!passwordOk(c, user, f.getOrDefault("password", ""))) { fail(ex, 400, "Current password is wrong."); return; }
            setColumn(c, "password_hash", hash(next), user);
        }
        // Log out every other device; keep the one that just changed the password.
        String current = token(ex);
        SESSIONS.entrySet().removeIf(en -> en.getValue().user.equals(user) && !en.getKey().equals(current));
        okMsg(ex, "Password changed. Other devices have been logged out.");
    }

    static void setSecurity(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String question = questionText(get(f, "question"));
        String answer = get(f, "answer").toLowerCase();
        if (question == null) { fail(ex, 400, "Choose a security question."); return; }
        if (answer.length() < 2 || answer.length() > 60) { fail(ex, 400, "Security answer must be 2-60 characters."); return; }
        try (Connection c = db()) {
            if (!passwordOk(c, user, f.getOrDefault("password", ""))) { fail(ex, 400, "Current password is wrong."); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE users SET security_question = ?, security_answer_hash = ? WHERE username = ?")) {
                ps.setString(1, question); ps.setString(2, hash(answer)); ps.setString(3, user);
                ps.executeUpdate();
            }
        }
        okMsg(ex, "Security question saved.");
    }

    /** Other students, people from the same course first. Marks whether the viewer already follows them. */
    static void people(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT u.username, u.name, u.role, u.course, u.interests, u.avatar_path, "
                + "EXISTS(SELECT 1 FROM follows WHERE follower_username = ? AND following_username = u.username) AS following "
                + "FROM users u WHERE u.username <> ? "
                + "ORDER BY (u.course <> '' AND u.course = (SELECT course FROM users WHERE username = ?)) DESC, u.created_at DESC LIMIT 12";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"people\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, user); ps.setString(2, user); ps.setString(3, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(",");
                    first = false;
                    sb.append("{\"username\":").append(js(rs.getString("username")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"role\":").append(js(rs.getString("role")))
                      .append(",\"course\":").append(js(rs.getString("course")))
                      .append(",\"interests\":").append(js(rs.getString("interests")))
                      .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                      .append(",\"following\":").append(rs.getBoolean("following")).append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    /** Escapes a user's raw search text for a LIKE pattern (MySQL's default escape char is backslash). */
    static String likePattern(String q) {
        return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%";
    }

    /** Global search across people, events, groups, lost&found items and rides. Up to 6 of each, most relevant first. */
    static void search(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String q = get(f, "q");
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"query\":" + js(q) + ",\"results\":[");
        boolean[] any = { false };
        if (!q.isEmpty()) {
            String like = likePattern(q);
            try (Connection c = db()) {
                String usql = "SELECT username, name, role, course, avatar_path FROM users "
                        + "WHERE username <> ? AND (username LIKE ? OR name LIKE ? OR course LIKE ?) "
                        + "ORDER BY (LOWER(username) = ?) DESC, created_at DESC LIMIT 6";
                try (PreparedStatement ps = c.prepareStatement(usql)) {
                    ps.setString(1, user); ps.setString(2, like); ps.setString(3, like); ps.setString(4, like);
                    ps.setString(5, q.toLowerCase());
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            if (any[0]) sb.append(","); any[0] = true;
                            sb.append("{\"type\":\"user\",\"username\":").append(js(rs.getString("username")))
                              .append(",\"name\":").append(js(rs.getString("name")))
                              .append(",\"role\":").append(js(rs.getString("role")))
                              .append(",\"course\":").append(js(rs.getString("course")))
                              .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                              .append("}");
                        }
                    }
                }

                String esql = "SELECT id, title, location, category, DATE_FORMAT(event_date, '%Y-%m-%d') AS d FROM events "
                        + "WHERE title LIKE ? OR description LIKE ? OR location LIKE ? "
                        + "ORDER BY event_date ASC LIMIT 6";
                try (PreparedStatement ps = c.prepareStatement(esql)) {
                    ps.setString(1, like); ps.setString(2, like); ps.setString(3, like);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            if (any[0]) sb.append(","); any[0] = true;
                            sb.append("{\"type\":\"event\",\"id\":").append(rs.getInt("id"))
                              .append(",\"title\":").append(js(rs.getString("title")))
                              .append(",\"location\":").append(js(rs.getString("location")))
                              .append(",\"category\":").append(js(rs.getString("category")))
                              .append(",\"date\":").append(js(rs.getString("d")))
                              .append("}");
                        }
                    }
                }

                String gsql = "SELECT g.id, g.name, g.category, "
                        + "(SELECT COUNT(*) FROM study_group_members WHERE group_id = g.id) AS members "
                        + "FROM study_groups g WHERE g.name LIKE ? OR g.description LIKE ? "
                        + "ORDER BY g.created_at DESC LIMIT 6";
                try (PreparedStatement ps = c.prepareStatement(gsql)) {
                    ps.setString(1, like); ps.setString(2, like);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            if (any[0]) sb.append(","); any[0] = true;
                            sb.append("{\"type\":\"group\",\"id\":").append(rs.getInt("id"))
                              .append(",\"name\":").append(js(rs.getString("name")))
                              .append(",\"category\":").append(js(rs.getString("category")))
                              .append(",\"members\":").append(rs.getInt("members"))
                              .append("}");
                        }
                    }
                }

                String lsql = "SELECT id, type, item_name, location, status FROM lost_found_items "
                        + "WHERE item_name LIKE ? OR description LIKE ? OR location LIKE ? "
                        + "ORDER BY created_at DESC LIMIT 6";
                try (PreparedStatement ps = c.prepareStatement(lsql)) {
                    ps.setString(1, like); ps.setString(2, like); ps.setString(3, like);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            if (any[0]) sb.append(","); any[0] = true;
                            sb.append("{\"type\":\"lostfound\",\"id\":").append(rs.getInt("id"))
                              .append(",\"item\":").append(js(rs.getString("item_name")))
                              .append(",\"itemType\":").append(js(rs.getString("type")))
                              .append(",\"location\":").append(js(rs.getString("location")))
                              .append(",\"status\":").append(js(rs.getString("status")))
                              .append("}");
                        }
                    }
                }

                String rsql = "SELECT id, type, from_location, to_location, DATE_FORMAT(ride_date, '%Y-%m-%d') AS d, status FROM rides "
                        + "WHERE from_location LIKE ? OR to_location LIKE ? OR notes LIKE ? "
                        + "ORDER BY ride_date ASC LIMIT 6";
                try (PreparedStatement ps = c.prepareStatement(rsql)) {
                    ps.setString(1, like); ps.setString(2, like); ps.setString(3, like);
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) {
                            if (any[0]) sb.append(","); any[0] = true;
                            sb.append("{\"type\":\"ride\",\"id\":").append(rs.getInt("id"))
                              .append(",\"from\":").append(js(rs.getString("from_location")))
                              .append(",\"to\":").append(js(rs.getString("to_location")))
                              .append(",\"date\":").append(js(rs.getString("d")))
                              .append(",\"rideType\":").append(js(rs.getString("type")))
                              .append(",\"status\":").append(js(rs.getString("status")))
                              .append("}");
                        }
                    }
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    // ---------------- Connections (follow / unfollow) ----------------
    static void followToggle(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String target = get(f, "username").toLowerCase();
        if (target.isEmpty()) { fail(ex, 400, "Missing username."); return; }
        if (target.equals(user)) { fail(ex, 400, "You can't follow yourself."); return; }
        try (Connection c = db()) {
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM users WHERE username = ?")) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) { fail(ex, 400, "That user doesn't exist."); return; }
                }
            }
            boolean nowFollowing = toggle(c, "follows", "follower_username", user, "following_username", target);
            if (nowFollowing) notify(c, target, user, "follow", null, null, "@" + user + " started following you.");
            send(ex, 200, JSON, "{\"ok\":true,\"following\":" + nowFollowing + "}");
        }
    }

    /** Followers and following for a user (defaults to the caller). Read-only, so it works for any profile. */
    static void connections(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String who = get(f, "username");
        String target = who.isEmpty() ? user : who.toLowerCase();
        StringBuilder followers = new StringBuilder("[");
        StringBuilder following = new StringBuilder("[");
        int followerCount = 0, followingCount = 0;
        try (Connection c = db()) {
            String fsql = "SELECT u.username, u.name, u.role, u.avatar_path FROM follows fo JOIN users u ON u.username = fo.follower_username "
                    + "WHERE fo.following_username = ? ORDER BY fo.created_at DESC";
            try (PreparedStatement ps = c.prepareStatement(fsql)) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) followers.append(","); first = false; followerCount++;
                        followers.append("{\"username\":").append(js(rs.getString("username")))
                                 .append(",\"name\":").append(js(rs.getString("name")))
                                 .append(",\"role\":").append(js(rs.getString("role")))
                                 .append(",\"avatar\":").append(js(rs.getString("avatar_path"))).append("}");
                    }
                }
            }
            String gsql = "SELECT u.username, u.name, u.role, u.avatar_path FROM follows fo JOIN users u ON u.username = fo.following_username "
                    + "WHERE fo.follower_username = ? ORDER BY fo.created_at DESC";
            try (PreparedStatement ps = c.prepareStatement(gsql)) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) following.append(","); first = false; followingCount++;
                        following.append("{\"username\":").append(js(rs.getString("username")))
                                 .append(",\"name\":").append(js(rs.getString("name")))
                                 .append(",\"role\":").append(js(rs.getString("role")))
                                 .append(",\"avatar\":").append(js(rs.getString("avatar_path"))).append("}");
                    }
                }
            }
        }
        send(ex, 200, JSON, "{\"ok\":true,\"username\":" + js(target) + ",\"isMe\":" + target.equals(user)
                + ",\"followerCount\":" + followerCount + ",\"followingCount\":" + followingCount
                + ",\"followers\":" + followers.append("]") + ",\"following\":" + following.append("]") + "}");
    }

    /** Public, read-only profile for any username (defaults to the caller). Used when someone taps a handle. */
    static void userProfile(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String who = get(f, "username");
        String target = who.isEmpty() ? user : who.toLowerCase();
        try (Connection c = db()) {
            String profile;
            try (PreparedStatement ps = c.prepareStatement("SELECT " + COLS + " FROM users WHERE username = ?")) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) { fail(ex, 404, "That user doesn't exist."); return; }
                    profile = profileJson(rs);
                }
            }
            boolean isFollowing = false;
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT 1 FROM follows WHERE follower_username = ? AND following_username = ?")) {
                ps.setString(1, user); ps.setString(2, target);
                try (ResultSet rs = ps.executeQuery()) { isFollowing = rs.next(); }
            }
            int followerCount = 0, followingCount = 0;
            try (PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) AS n FROM follows WHERE following_username = ?")) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) followerCount = rs.getInt("n"); }
            }
            try (PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) AS n FROM follows WHERE follower_username = ?")) {
                ps.setString(1, target);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) followingCount = rs.getInt("n"); }
            }
            send(ex, 200, JSON, "{\"ok\":true,\"user\":" + profile + ",\"isMe\":" + target.equals(user)
                    + ",\"isFollowing\":" + isFollowing
                    + ",\"followerCount\":" + followerCount + ",\"followingCount\":" + followingCount + "}");
        }
    }

    // ---------------- Posts / feed ----------------
    static void postsCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String content = get(f, "content");
        String photo = get(f, "photo");
        int groupId = toInt(get(f, "groupId"), -1); // -1 = main dashboard feed
        if (content.isEmpty() || content.length() > 1000) { fail(ex, 400, "A post must be 1-1000 characters."); return; }
        String imagePath;
        try {
            imagePath = photo.isEmpty() ? null : saveImage(photo, "posts");
        } catch (IllegalArgumentException e) {
            fail(ex, 400, e.getMessage());
            return;
        }
        try (Connection c = db()) {
            int newId = -1;
            if (groupId >= 0) {
                String gRole = groupRole(c, groupId, user);
                if (gRole == null) { fail(ex, 400, "Join the group before posting in it."); return; }
                if (!"admin".equals(gRole)) { fail(ex, 403, "Only group admins can post here."); return; }
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO posts (username, group_id, content, image_path) VALUES (?, ?, ?, ?)", Statement.RETURN_GENERATED_KEYS)) {
                    ps.setString(1, user); ps.setInt(2, groupId); ps.setString(3, content); ps.setString(4, imagePath);
                    ps.executeUpdate();
                    try (ResultSet k = ps.getGeneratedKeys()) { if (k.next()) newId = k.getInt(1); }
                }
            } else {
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO posts (username, content, image_path) VALUES (?, ?, ?)", Statement.RETURN_GENERATED_KEYS)) {
                    ps.setString(1, user); ps.setString(2, content); ps.setString(3, imagePath);
                    ps.executeUpdate();
                    try (ResultSet k = ps.getGeneratedKeys()) { if (k.next()) newId = k.getInt(1); }
                }
            }
            if (newId >= 0) {
                if (groupId >= 0) notifyMentions(c, content, user, "group", groupId, "a group post", null, groupId);
                else notifyMentions(c, content, user, "post", newId, "a post", null, -1);
            }
        }
        okMsg(ex, "Posted.");
    }

    /** The main feed (groupId omitted) or one group's feed (groupId given). */
    static void postsList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int groupId = toInt(get(f, "groupId"), -1);
        String sql = "SELECT p.id, p.username, u.name, u.role, u.avatar_path, p.content, p.image_path, "
                + "DATE_FORMAT(p.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created, "
                + "(SELECT COUNT(*) FROM post_likes WHERE post_id = p.id) AS likes, "
                + "(SELECT COUNT(*) FROM post_comments WHERE post_id = p.id) AS comments, "
                + "EXISTS(SELECT 1 FROM post_likes WHERE post_id = p.id AND username = ?) AS liked "
                + "FROM posts p JOIN users u ON u.username = p.username "
                + (groupId >= 0 ? "WHERE p.group_id = ? " : "WHERE p.group_id IS NULL ")
                + "ORDER BY p.created_at DESC LIMIT 50";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"posts\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            if (groupId >= 0 && groupRole(c, groupId, user) == null) { fail(ex, 403, "Join the group to see its posts."); return; }
            ps.setString(1, user);
            if (groupId >= 0) ps.setInt(2, groupId);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"username\":").append(js(rs.getString("username")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"role\":").append(js(rs.getString("role")))
                      .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                      .append(",\"content\":").append(js(rs.getString("content")))
                      .append(",\"image\":").append(js(rs.getString("image_path")))
                      .append(",\"created\":").append(js(rs.getString("created")))
                      .append(",\"likes\":").append(rs.getInt("likes"))
                      .append(",\"comments\":").append(rs.getInt("comments"))
                      .append(",\"liked\":").append(rs.getBoolean("liked"))
                      .append(",\"mine\":").append(rs.getString("username").equals(user))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void postsLike(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int postId = toInt(get(f, "postId"), -1);
        if (postId < 0) { fail(ex, 400, "Missing post."); return; }
        try (Connection c = db()) {
            boolean nowLiked = toggle(c, "post_likes", "post_id", String.valueOf(postId), "username", user);
            if (nowLiked) {
                String owner = ownerOf(c, "posts", "id", "username", postId);
                if (owner != null && !owner.equals(user)) {
                    int gid = groupOfPost(c, postId);
                    notify(c, owner, user, "like", gid >= 0 ? "group" : "post", gid >= 0 ? gid : postId, "@" + user + " liked your post.");
                }
            }
            send(ex, 200, JSON, "{\"ok\":true,\"liked\":" + nowLiked + "}");
        }
    }

    static void postsComment(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int postId = toInt(get(f, "postId"), -1);
        String content = get(f, "content");
        if (postId < 0) { fail(ex, 400, "Missing post."); return; }
        if (content.isEmpty() || content.length() > 300) { fail(ex, 400, "A comment must be 1-300 characters."); return; }
        try (Connection c = db()) {
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO post_comments (post_id, username, content) VALUES (?, ?, ?)")) {
                ps.setInt(1, postId); ps.setString(2, user); ps.setString(3, content);
                ps.executeUpdate();
            }
            String owner = ownerOf(c, "posts", "id", "username", postId);
            int gid = groupOfPost(c, postId);
            String tType = gid >= 0 ? "group" : "post";
            int tId = gid >= 0 ? gid : postId;
            if (owner != null && !owner.equals(user)) notify(c, owner, user, "comment", tType, tId, "@" + user + " commented on your post.");
            // The post's owner already got the "commented" notification above, so don't ping them twice.
            notifyMentions(c, content, user, tType, tId, "a comment", owner == null ? null : Set.of(owner), gid);
        }
        okMsg(ex, "Comment added.");
    }

    static void postsComments(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int postId = toInt(get(f, "postId"), -1);
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"comments\":[");
        if (postId >= 0) {
            String sql = "SELECT pc.username, u.name, u.avatar_path, pc.content, DATE_FORMAT(pc.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                    + "FROM post_comments pc JOIN users u ON u.username = pc.username WHERE pc.post_id = ? ORDER BY pc.created_at ASC";
            try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, postId);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"username\":").append(js(rs.getString("username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                          .append(",\"content\":").append(js(rs.getString("content")))
                          .append(",\"created\":").append(js(rs.getString("created"))).append("}");
                    }
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void postsDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        deleteOwned(ex, f, user, "posts", "id", "username", "image_path");
    }

    // ---------------- Events (with likes, comments, RSVPs) ----------------
    static void eventsCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String title = get(f, "title"), description = get(f, "description"), location = get(f, "location"),
               category = get(f, "category"), date = get(f, "date"), time = get(f, "time");
        if (title.isEmpty() || title.length() > 80) { fail(ex, 400, "Give the event a title (up to 80 characters)."); return; }
        if (date.isEmpty()) { fail(ex, 400, "Pick a date for the event."); return; }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "INSERT INTO events (created_by, title, description, location, category, event_date, event_time) VALUES (?,?,?,?,?,?,?)")) {
            ps.setString(1, user); ps.setString(2, title); ps.setString(3, description);
            ps.setString(4, location); ps.setString(5, category.isEmpty() ? "General" : category); ps.setString(6, date);
            if (time.isEmpty()) ps.setNull(7, Types.TIME); else ps.setString(7, time);
            ps.executeUpdate();
        }
        okMsg(ex, "Event created.");
    }

    static void eventsList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT e.id, e.created_by, u.name, e.title, e.description, e.location, e.category, "
                + "DATE_FORMAT(e.event_date, '%Y-%m-%d') AS event_date, "
                + "DATE_FORMAT(e.event_time, '%H:%i') AS event_time, "
                + "(SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'going') AS going_count, "
                + "(SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id AND status = 'interested') AS interested_count, "
                + "(SELECT COUNT(*) FROM event_likes WHERE event_id = e.id) AS likes, "
                + "(SELECT COUNT(*) FROM event_comments WHERE event_id = e.id) AS comments, "
                + "(SELECT status FROM event_rsvps WHERE event_id = e.id AND username = ?) AS my_rsvp, "
                + "EXISTS(SELECT 1 FROM event_likes WHERE event_id = e.id AND username = ?) AS liked "
                + "FROM events e JOIN users u ON u.username = e.created_by "
                + "ORDER BY e.event_date ASC, e.id DESC LIMIT 50";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"events\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, user); ps.setString(2, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"username\":").append(js(rs.getString("created_by")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"title\":").append(js(rs.getString("title")))
                      .append(",\"description\":").append(js(rs.getString("description")))
                      .append(",\"location\":").append(js(rs.getString("location")))
                      .append(",\"category\":").append(js(rs.getString("category")))
                      .append(",\"date\":").append(js(rs.getString("event_date")))
                      .append(",\"time\":").append(js(rs.getString("event_time")))
                      .append(",\"going\":").append(rs.getInt("going_count"))
                      .append(",\"interested\":").append(rs.getInt("interested_count"))
                      .append(",\"likes\":").append(rs.getInt("likes"))
                      .append(",\"comments\":").append(rs.getInt("comments"))
                      .append(",\"liked\":").append(rs.getBoolean("liked"))
                      .append(",\"myRsvp\":").append(js(rs.getString("my_rsvp")))
                      .append(",\"mine\":").append(rs.getString("created_by").equals(user))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    /** status is "going", "interested", or empty to remove any RSVP. */
    static void eventsRsvp(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "eventId"), -1);
        String status = get(f, "status");
        if (id < 0) { fail(ex, 400, "Missing event."); return; }
        if (!status.isEmpty() && !status.equals("going") && !status.equals("interested")) {
            fail(ex, 400, "Status must be going or interested."); return;
        }
        try (Connection c = db()) {
            if (status.isEmpty()) {
                try (PreparedStatement ps = c.prepareStatement("DELETE FROM event_rsvps WHERE event_id = ? AND username = ?")) {
                    ps.setInt(1, id); ps.setString(2, user);
                    ps.executeUpdate();
                }
            } else {
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO event_rsvps (event_id, username, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status)")) {
                    ps.setInt(1, id); ps.setString(2, user); ps.setString(3, status);
                    ps.executeUpdate();
                }
                String owner = ownerOf(c, "events", "id", "created_by", id);
                if (owner != null && !owner.equals(user)) notify(c, owner, user, "rsvp", "event", id, "@" + user + " is " + status + " for your event.");
            }
            send(ex, 200, JSON, "{\"ok\":true,\"status\":" + js(status) + "}");
        }
    }

    static void eventsLike(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "eventId"), -1);
        if (id < 0) { fail(ex, 400, "Missing event."); return; }
        try (Connection c = db()) {
            boolean nowLiked = toggle(c, "event_likes", "event_id", String.valueOf(id), "username", user);
            if (nowLiked) {
                String owner = ownerOf(c, "events", "id", "created_by", id);
                if (owner != null && !owner.equals(user)) notify(c, owner, user, "like", "event", id, "@" + user + " liked your event.");
            }
            send(ex, 200, JSON, "{\"ok\":true,\"liked\":" + nowLiked + "}");
        }
    }

    static void eventsComment(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "eventId"), -1);
        String content = get(f, "content");
        if (id < 0) { fail(ex, 400, "Missing event."); return; }
        if (content.isEmpty() || content.length() > 300) { fail(ex, 400, "A comment must be 1-300 characters."); return; }
        try (Connection c = db()) {
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO event_comments (event_id, username, content) VALUES (?, ?, ?)")) {
                ps.setInt(1, id); ps.setString(2, user); ps.setString(3, content);
                ps.executeUpdate();
            }
            String owner = ownerOf(c, "events", "id", "created_by", id);
            if (owner != null && !owner.equals(user)) notify(c, owner, user, "comment", "event", id, "@" + user + " commented on your event.");
            notifyMentions(c, content, user, "event", id, "a comment", owner == null ? null : Set.of(owner), -1);
        }
        okMsg(ex, "Comment added.");
    }

    static void eventsComments(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "eventId"), -1);
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"comments\":[");
        if (id >= 0) {
            String sql = "SELECT ec.username, u.name, u.avatar_path, ec.content, DATE_FORMAT(ec.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                    + "FROM event_comments ec JOIN users u ON u.username = ec.username WHERE ec.event_id = ? ORDER BY ec.created_at ASC";
            try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"username\":").append(js(rs.getString("username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                          .append(",\"content\":").append(js(rs.getString("content")))
                          .append(",\"created\":").append(js(rs.getString("created"))).append("}");
                    }
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void eventsDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        deleteOwned(ex, f, user, "events", "id", "created_by");
    }

    // ---------------- Music groups (music_groups / music_group_members) ----------------
    // Every music group has one leader: whoever created it, until they hand it to another member.
    // Only the leader can change what is playing. The server keeps one shared playback state per
    // group, and every listener's player follows it (the page polls /api/music/state).

    static final Pattern YT_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");

    static void createMusicTables(Connection c) throws SQLException {
        try (Statement st = c.createStatement()) {
            st.executeUpdate("CREATE TABLE IF NOT EXISTS music_groups ("
                    + "id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(60) NOT NULL, "
                    + "description VARCHAR(300) NOT NULL DEFAULT '', leader VARCHAR(30) NOT NULL, "
                    + "video_id VARCHAR(16) NULL, playing TINYINT(1) NOT NULL DEFAULT 0, "
                    + "position_sec DOUBLE NOT NULL DEFAULT 0, updated_ms BIGINT NOT NULL DEFAULT 0, "
                    + "rev INT NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                    + "UNIQUE KEY uq_music_name (name))");
            // join_by_ms: while > 0 the leader hasn't joined yet and must do so before this time (ms since epoch).
            boolean has;
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    + "AND TABLE_NAME = 'music_groups' AND COLUMN_NAME = 'join_by_ms'");
                 ResultSet rs = ps.executeQuery()) { has = rs.next(); }
            if (!has) st.executeUpdate("ALTER TABLE music_groups ADD COLUMN join_by_ms BIGINT NOT NULL DEFAULT 0");
            // away_since_ms: > 0 means this member's page was closed/left at that time; they are removed after a short grace period.
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    + "AND TABLE_NAME = 'music_group_members' AND COLUMN_NAME = 'away_since_ms'");
                 ResultSet rs = ps.executeQuery()) { has = rs.next(); }
            if (!has) st.executeUpdate("ALTER TABLE music_group_members ADD COLUMN away_since_ms BIGINT NOT NULL DEFAULT 0");
            st.executeUpdate("CREATE TABLE IF NOT EXISTS music_group_members ("
                    + "group_id INT NOT NULL, username VARCHAR(30) NOT NULL, "
                    + "joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (group_id, username))");
            // last_seen_ms: heartbeat. A member whose page hasn't pinged for MUSIC_STALE_MS is removed even if the "away" beacon never arrived.
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                    + "AND TABLE_NAME = 'music_group_members' AND COLUMN_NAME = 'last_seen_ms'");
                 ResultSet rs = ps.executeQuery()) { has = rs.next(); }
            if (!has) st.executeUpdate("ALTER TABLE music_group_members ADD COLUMN last_seen_ms BIGINT NOT NULL DEFAULT 0");
        }
    }

    static boolean isMusicMember(Connection c, int gid, String user) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM music_group_members WHERE group_id = ? AND username = ?")) {
            ps.setInt(1, gid); ps.setString(2, user);
            try (ResultSet rs = ps.executeQuery()) { return rs.next(); }
        }
    }

    /** Username of a music group's leader, or null if the group doesn't exist. */
    static String musicLeader(Connection c, int gid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT leader FROM music_groups WHERE id = ?")) {
            ps.setInt(1, gid);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getString(1) : null; }
        }
    }

    /** How long a new music group's leader has to join it before the empty group is deleted. */
    static final long MUSIC_JOIN_WINDOW_MS = 10 * 60 * 1000L;

    /** Deletes every music group whose leader never joined within the window. */
    static void purgeExpiredMusic(Connection c) throws SQLException {
        List<Integer> ids = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT id FROM music_groups WHERE join_by_ms > 0 AND join_by_ms < ?")) {
            ps.setLong(1, System.currentTimeMillis());
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) ids.add(rs.getInt(1)); }
        }
        for (int id : ids) deleteMusicGroup(c, id);
        purgeAwayMembers(c);
    }

    /** How long a member's page can be gone before they are taken out of the group (so a refresh doesn't kick anyone). */
    static final long MUSIC_AWAY_GRACE_MS = 10 * 1000L;

    /** A member with no heartbeat for this long is treated as gone (tab killed, phone locked, browser crashed, no network...). */
    static final long MUSIC_STALE_MS = 2 * 60 * 1000L;

    /** Removes members who left the music page and didn't come back within the grace period. */
    static void purgeAwayMembers(Connection c) throws SQLException {
        List<Object[]> gone = new ArrayList<>();
        try (PreparedStatement ps = c.prepareStatement("SELECT group_id, username FROM music_group_members WHERE (away_since_ms > 0 AND away_since_ms < ?) OR last_seen_ms < ?")) {
            ps.setLong(1, System.currentTimeMillis() - MUSIC_AWAY_GRACE_MS);
            ps.setLong(2, System.currentTimeMillis() - MUSIC_STALE_MS);
            try (ResultSet rs = ps.executeQuery()) { while (rs.next()) gone.add(new Object[]{rs.getInt(1), rs.getString(2)}); }
        }
        for (Object[] g : gone) autoLeaveMusic(c, (Integer) g[0], (String) g[1]);
    }

    /**
     * Takes a member out of a group. A leader who leaves hands leadership to the member who joined
     * earliest; if nobody else is left, the group is deleted.
     */
    static void autoLeaveMusic(Connection c, int gid, String user) throws SQLException {
        String leader = musicLeader(c, gid);
        if (leader == null) return;
        if (user.equals(leader)) {
            String next = null;
            try (PreparedStatement ps = c.prepareStatement("SELECT username FROM music_group_members WHERE group_id = ? AND username <> ? ORDER BY joined_at ASC LIMIT 1")) {
                ps.setInt(1, gid); ps.setString(2, user);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) next = rs.getString(1); }
            }
            if (next == null) { deleteMusicGroup(c, gid); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE music_groups SET leader = ?, rev = rev + 1 WHERE id = ?")) {
                ps.setString(1, next); ps.setInt(2, gid); ps.executeUpdate();
            }
        }
        try (PreparedStatement ps = c.prepareStatement("DELETE FROM music_group_members WHERE group_id = ? AND username = ?")) {
            ps.setInt(1, gid); ps.setString(2, user); ps.executeUpdate();
        }
    }

    /** Heartbeat from the room page (sent even while the tab is in the background). */
    static void musicPing(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE music_group_members SET last_seen_ms = ?, away_since_ms = 0 WHERE group_id = ? AND username = ?")) {
            ps.setLong(1, System.currentTimeMillis()); ps.setInt(2, id); ps.setString(3, user);
            ps.executeUpdate();
        }
        okMsg(ex, "OK");
    }

    /** Called by the room page when it is closed or navigated away from. Starts the grace period. */
    static void musicAway(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE music_group_members SET away_since_ms = ? WHERE group_id = ? AND username = ?")) {
            ps.setLong(1, System.currentTimeMillis()); ps.setInt(2, id); ps.setString(3, user);
            ps.executeUpdate();
        }
        okMsg(ex, "OK");
    }

    /** True while the group is still waiting for its leader to join. */
    static boolean musicPending(Connection c, int gid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT join_by_ms FROM music_groups WHERE id = ?")) {
            ps.setInt(1, gid);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() && rs.getLong(1) > 0; }
        }
    }

    static void musicGone(HttpExchange ex, int code, String message) throws IOException {
        send(ex, code, JSON, "{\"ok\":false,\"gone\":true,\"message\":" + js(message) + "}");
    }

    static void musicCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String name = get(f, "name"), description = get(f, "description");
        if (name.isEmpty() || name.length() > 60) { fail(ex, 400, "Give the group a name (up to 60 characters)."); return; }
        if (description.length() > 300) { fail(ex, 400, "Keep the description under 300 characters."); return; }
        try (Connection c = db()) {
            int id;
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO music_groups (name, description, leader, updated_ms, join_by_ms) VALUES (?,?,?,?,?)",
                    Statement.RETURN_GENERATED_KEYS)) {
                ps.setString(1, name); ps.setString(2, description); ps.setString(3, user);
                ps.setLong(4, System.currentTimeMillis());
                ps.setLong(5, System.currentTimeMillis() + MUSIC_JOIN_WINDOW_MS);
                ps.executeUpdate();
                try (ResultSet keys = ps.getGeneratedKeys()) { keys.next(); id = keys.getInt(1); }
            } catch (SQLIntegrityConstraintViolationException e) {
                fail(ex, 400, "A music group with that name already exists.");
                return;
            }
            // The group starts empty: the leader has MUSIC_JOIN_WINDOW_MS to join it, or it is deleted.
            send(ex, 200, JSON, "{\"ok\":true,\"id\":" + id + "}");
        }
    }

    static void musicList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        try (Connection c0 = db()) { purgeExpiredMusic(c0); }
        String sql = "SELECT g.id, g.name, g.description, g.leader, g.video_id, g.playing, g.join_by_ms, "
                + "(SELECT COUNT(*) FROM music_group_members WHERE group_id = g.id) AS members, "
                + "(SELECT COUNT(*) FROM music_group_members WHERE group_id = g.id AND username = ?) AS joined "
                + "FROM music_groups g ORDER BY g.created_at DESC LIMIT 200";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"groups\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            // First few listeners of every group (for the avatar stack on each card).
            Map<Integer, List<String[]>> listeners = new HashMap<>();
            try (PreparedStatement lp = c.prepareStatement("SELECT m.group_id, m.username, u.name, u.avatar_path FROM music_group_members m "
                    + "LEFT JOIN users u ON u.username = m.username ORDER BY m.group_id, m.joined_at ASC");
                 ResultSet lr = lp.executeQuery()) {
                while (lr.next()) {
                    List<String[]> l = listeners.computeIfAbsent(lr.getInt(1), k -> new ArrayList<>());
                    if (l.size() < 4) l.add(new String[]{lr.getString(2), lr.getString(3), lr.getString(4)});
                }
            }
            ps.setString(1, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"description\":").append(js(rs.getString("description")))
                      .append(",\"leader\":").append(js(rs.getString("leader")))
                      .append(",\"members\":").append(rs.getInt("members"))
                      .append(",\"joined\":").append(rs.getInt("joined") > 0)
                      .append(",\"isLeader\":").append(user.equals(rs.getString("leader")))
                      .append(",\"pending\":").append(rs.getLong("join_by_ms") > 0)
                      .append(",\"live\":").append(rs.getString("video_id") != null && rs.getInt("playing") == 1)
                      .append(",\"videoId\":").append(rs.getString("video_id") == null ? "null" : js(rs.getString("video_id")))
                      .append(",\"msLeft\":").append(rs.getLong("join_by_ms") > 0 ? Math.max(0, rs.getLong("join_by_ms") - System.currentTimeMillis()) : 0)
                      .append(",\"listeners\":[");
                    List<String[]> ls = listeners.getOrDefault(rs.getInt("id"), Collections.<String[]>emptyList());
                    for (int i = 0; i < ls.size(); i++) {
                        String[] l = ls.get(i);
                        if (i > 0) sb.append(",");
                        sb.append("{\"username\":").append(js(l[0]))
                          .append(",\"name\":").append(js(l[1] == null ? l[0] : l[1]))
                          .append(",\"avatar\":").append(js(l[2])).append("}");
                    }
                    sb.append("]}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void musicJoin(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            purgeExpiredMusic(c);
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist (the leader didn't join in time, or it was deleted)."); return; }
            boolean pending = musicPending(c, id);
            if (pending && !user.equals(leader)) { fail(ex, 400, "This group is waiting for @" + leader + " to join. Try again in a moment."); return; }
            try (PreparedStatement ps = c.prepareStatement("INSERT IGNORE INTO music_group_members (group_id, username) VALUES (?, ?)")) {
                ps.setInt(1, id); ps.setString(2, user);
                ps.executeUpdate();
            }
            try (PreparedStatement ps = c.prepareStatement("UPDATE music_group_members SET last_seen_ms = ?, away_since_ms = 0 WHERE group_id = ? AND username = ?")) {
                ps.setLong(1, System.currentTimeMillis()); ps.setInt(2, id); ps.setString(3, user);
                ps.executeUpdate();
            }
            if (pending) {   // the leader is in: the countdown is over
                try (PreparedStatement ps = c.prepareStatement("UPDATE music_groups SET join_by_ms = 0, rev = rev + 1 WHERE id = ?")) {
                    ps.setInt(1, id); ps.executeUpdate();
                }
            }
        }
        okMsg(ex, "You joined the group.");
    }

    static void deleteMusicGroup(Connection c, int id) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("DELETE FROM music_group_members WHERE group_id = ?")) {
            ps.setInt(1, id); ps.executeUpdate();
        }
        try (PreparedStatement ps = c.prepareStatement("DELETE FROM music_groups WHERE id = ?")) {
            ps.setInt(1, id); ps.executeUpdate();
        }
    }

    static void musicLeave(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist."); return; }
            if (user.equals(leader)) {
                int count;
                try (PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) FROM music_group_members WHERE group_id = ?")) {
                    ps.setInt(1, id);
                    try (ResultSet rs = ps.executeQuery()) { rs.next(); count = rs.getInt(1); }
                }
                if (count > 1) { fail(ex, 400, "You're the leader. Make someone else the leader before you leave."); return; }
                deleteMusicGroup(c, id);   // the leader was the only member, so the group ends with them
                okMsg(ex, "You left, and the empty group was deleted.");
                return;
            }
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM music_group_members WHERE group_id = ? AND username = ?")) {
                ps.setInt(1, id); ps.setString(2, user); ps.executeUpdate();
            }
        }
        okMsg(ex, "You left the group.");
    }

    static void musicDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist."); return; }
            if (!user.equals(leader)) { fail(ex, 403, "Only the leader can delete the group."); return; }
            deleteMusicGroup(c, id);
        }
        okMsg(ex, "Group deleted.");
    }

    /** Everything a room page needs: the group, the shared playback state and the members. Members only. */
    static void musicState(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            purgeExpiredMusic(c);
            String name, description, leader, video;
            boolean playing;
            double position;
            long updated, joinBy;
            int rev;
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT name, description, leader, video_id, playing, position_sec, updated_ms, rev, join_by_ms FROM music_groups WHERE id = ?")) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) { musicGone(ex, 404, "That music group isn't here any more."); return; }
                    name = rs.getString(1); description = rs.getString(2); leader = rs.getString(3);
                    video = rs.getString(4); playing = rs.getInt(5) == 1; position = rs.getDouble(6);
                    updated = rs.getLong(7); rev = rs.getInt(8); joinBy = rs.getLong(9);
                }
            }
            // The leader may open a brand-new room before joining it (that is how they join within the window).
            if (!isMusicMember(c, id, user) && !(joinBy > 0 && user.equals(leader))) { musicGone(ex, 403, "Join this group to listen in."); return; }

            try (PreparedStatement ps = c.prepareStatement("UPDATE music_group_members SET away_since_ms = 0, last_seen_ms = ? WHERE group_id = ? AND username = ?")) {
                ps.setLong(1, System.currentTimeMillis()); ps.setInt(2, id); ps.setString(3, user); ps.executeUpdate();   // they're back (e.g. a page refresh)
            }

            // While it's playing, the saved position is from when the leader last pressed something.
            double now = playing ? position + (System.currentTimeMillis() - updated) / 1000.0 : position;

            List<String> usernames = new ArrayList<>();
            try (PreparedStatement ps = c.prepareStatement("SELECT username FROM music_group_members WHERE group_id = ? ORDER BY joined_at ASC")) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) { while (rs.next()) usernames.add(rs.getString(1)); }
            }
            Map<String, String[]> info = new HashMap<>();
            if (!usernames.isEmpty()) {
                String marks = String.join(",", Collections.nCopies(usernames.size(), "?"));
                try (PreparedStatement ps = c.prepareStatement("SELECT username, name, role, avatar_path FROM users WHERE username IN (" + marks + ")")) {
                    for (int i = 0; i < usernames.size(); i++) ps.setString(i + 1, usernames.get(i));
                    try (ResultSet rs = ps.executeQuery()) {
                        while (rs.next()) info.put(rs.getString(1), new String[]{rs.getString(2), rs.getString(3), rs.getString(4)});
                    }
                }
            }

            StringBuilder sb = new StringBuilder("{\"ok\":true");
            sb.append(",\"group\":{\"id\":").append(id)
              .append(",\"name\":").append(js(name))
              .append(",\"description\":").append(js(description))
              .append(",\"leader\":").append(js(leader))
              .append(",\"pending\":").append(joinBy > 0)
              .append(",\"msLeft\":").append(joinBy > 0 ? Math.max(0, joinBy - System.currentTimeMillis()) : 0).append("}")
              .append(",\"state\":{\"videoId\":").append(video == null ? "null" : js(video))
              .append(",\"playing\":").append(playing)
              .append(",\"position\":").append(String.format(java.util.Locale.ROOT, "%.2f", now))
              .append(",\"rev\":").append(rev).append("}")
              .append(",\"members\":[");
            boolean first = true;
            for (String u : usernames) {
                String[] i = info.getOrDefault(u, new String[]{u, "hostellor", null});
                if (!first) sb.append(","); first = false;
                sb.append("{\"username\":").append(js(u))
                  .append(",\"name\":").append(js(i[0]))
                  .append(",\"role\":").append(js(i[1]))
                  .append(",\"avatar\":").append(js(i[2]))
                  .append(",\"leader\":").append(u.equals(leader)).append("}");
            }
            send(ex, 200, JSON, sb.append("]}").toString());
        }
    }

    // ---------------- Music search (YouTube Data API v3) ----------------
    // Only a music group's leader can search, and only after logging in. A search costs 100 of the
    // free 10,000 daily quota units, so results are cached for 10 minutes and each user is limited
    // to one search every 1.5 seconds.
    static final HttpClient HTTP = HttpClient.newHttpClient();
    static final Map<String, Long> SEARCH_LAST = new ConcurrentHashMap<>();
    static final Map<String, Object[]> SEARCH_CACHE = new ConcurrentHashMap<>();   // query -> {timeMs, json}
    static final Pattern YT_ITEM = Pattern.compile("\"kind\"\\s*:\\s*\"youtube#searchResult\"");
    static final Pattern YT_VIDEO_ID = Pattern.compile("\"videoId\"\\s*:\\s*\"([A-Za-z0-9_-]{11})\"");
    static final Pattern YT_TITLE = Pattern.compile("\"title\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
    static final Pattern YT_CHANNEL = Pattern.compile("\"channelTitle\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

    
    static String ytText(String raw) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < raw.length(); i++) {
            char ch = raw.charAt(i);
            if (ch != '\\' || i + 1 >= raw.length()) { sb.append(ch); continue; }
            char n = raw.charAt(++i);
            switch (n) {
                case 'n': case 't': case 'r': sb.append(' '); break;
                case 'u':
                    if (i + 4 < raw.length()) {
                        try { sb.append((char) Integer.parseInt(raw.substring(i + 1, i + 5), 16)); i += 4; break; }
                        catch (NumberFormatException ignored) {}
                    }
                    sb.append('u'); break;
                default: sb.append(n);
            }
        }
        return sb.toString().replace("&quot;", "\"").replace("&#39;", "'").replace("&lt;", "<")
                .replace("&gt;", ">").replace("&amp;", "&");
    }

    /** Leader only: search YouTube for videos to play in the group. */
    static void musicSearch(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String q = get(f, "q");
        if (q.length() < 2) { fail(ex, 400, "Type a song or artist to search for."); return; }
        if (q.length() > 100) q = q.substring(0, 100);
        try (Connection c = db()) {
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist."); return; }
            if (!user.equals(leader)) { fail(ex, 403, "Only the group leader can search for music."); return; }
            if (musicPending(c, id)) { fail(ex, 400, "Join the group first."); return; }
        }
        if (YT_API_KEY.isEmpty() || YT_API_KEY.startsWith("PASTE_")) { fail(ex, 503, "Music search isn't set up yet: the server has no YouTube API key."); return; }

        long now = System.currentTimeMillis();
        Long last = SEARCH_LAST.put(user, now);
        if (last != null && now - last < 1500) { fail(ex, 429, "Slow down a little, then search again."); return; }

        String cacheKey = q.toLowerCase();
        Object[] hit = SEARCH_CACHE.get(cacheKey);
        if (hit != null && now - (Long) hit[0] < 10 * 60 * 1000L) { send(ex, 200, JSON, (String) hit[1]); return; }

        String url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true"
                + "&safeSearch=moderate&maxResults=8&q=" + URLEncoder.encode(q, StandardCharsets.UTF_8)
                + "&key=" + URLEncoder.encode(YT_API_KEY, StandardCharsets.UTF_8);
        HttpResponse<String> res = HTTP.send(
                HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).GET().build(),
                HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (res.statusCode() != 200) {
            System.err.println("YouTube search failed (" + res.statusCode() + "): " + res.body());
            fail(ex, 502, res.statusCode() == 403
                    ? "YouTube search is unavailable right now (the API quota or key may need attention)."
                    : "YouTube search failed. Check the server console.");
            return;
        }

        StringBuilder sb = new StringBuilder("{\"ok\":true,\"results\":[");
        String[] chunks = YT_ITEM.split(res.body());       // chunk 0 is the header; each later chunk is one result
        boolean first = true;
        for (int i = 1; i < chunks.length; i++) {
            Matcher vid = YT_VIDEO_ID.matcher(chunks[i]);
            Matcher title = YT_TITLE.matcher(chunks[i]);
            Matcher chan = YT_CHANNEL.matcher(chunks[i]);
            if (!vid.find() || !title.find()) continue;
            if (!first) sb.append(",");
            first = false;
            sb.append("{\"id\":").append(js(vid.group(1)))
              .append(",\"title\":").append(js(ytText(title.group(1))))
              .append(",\"channel\":").append(js(chan.find() ? ytText(chan.group(1)) : ""))
              .append("}");
        }
        String json = sb.append("]}").toString();
        if (SEARCH_CACHE.size() > 200) SEARCH_CACHE.clear();
        SEARCH_CACHE.put(cacheKey, new Object[]{now, json});
        send(ex, 200, JSON, json);
    }

    /** Leader only: load a video, play, pause or seek for the whole group. */
    static void musicControl(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String action = get(f, "action");
        double time;
        try { time = Double.parseDouble(get(f, "time")); } catch (NumberFormatException e) { time = 0; }
        if (Double.isNaN(time) || time < 0 || time > 86400) time = 0;
        long nowMs = System.currentTimeMillis();
        try (Connection c = db()) {
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist."); return; }
            if (!user.equals(leader)) { fail(ex, 403, "Only the group leader can control the music."); return; }
            if (musicPending(c, id)) { fail(ex, 400, "Join the group first."); return; }
            String sql;
            switch (action) {
                case "load":
                    if (!YT_ID.matcher(get(f, "videoId")).matches()) { fail(ex, 400, "That doesn't look like a YouTube video."); return; }
                    sql = "UPDATE music_groups SET video_id = ?, playing = 1, position_sec = 0, updated_ms = ?, rev = rev + 1 WHERE id = ?";
                    try (PreparedStatement ps = c.prepareStatement(sql)) {
                        ps.setString(1, get(f, "videoId")); ps.setLong(2, nowMs); ps.setInt(3, id); ps.executeUpdate();
                    }
                    break;
                case "play": case "pause": case "seek":
                    // seek keeps whatever state it was in; play and pause set it
                    sql = action.equals("seek")
                            ? "UPDATE music_groups SET position_sec = ?, updated_ms = ?, rev = rev + 1 WHERE id = ?"
                            : "UPDATE music_groups SET playing = " + (action.equals("play") ? 1 : 0) + ", position_sec = ?, updated_ms = ?, rev = rev + 1 WHERE id = ?";
                    try (PreparedStatement ps = c.prepareStatement(sql)) {
                        ps.setDouble(1, time); ps.setLong(2, nowMs); ps.setInt(3, id); ps.executeUpdate();
                    }
                    break;
                default:
                    fail(ex, 400, "Unknown action.");
                    return;
            }
        }
        okMsg(ex, "Done.");
    }

    /** Leader only: hand leadership to another member of the group. */
    static void musicTransfer(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String to = get(f, "username").toLowerCase();
        try (Connection c = db()) {
            String leader = musicLeader(c, id);
            if (leader == null) { fail(ex, 404, "That music group doesn't exist."); return; }
            if (!user.equals(leader)) { fail(ex, 403, "Only the leader can hand over leadership."); return; }
            if (to.equals(user)) { fail(ex, 400, "You're already the leader."); return; }
            if (!isMusicMember(c, id, to)) { fail(ex, 400, "That person isn't in this group."); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE music_groups SET leader = ?, rev = rev + 1 WHERE id = ?")) {
                ps.setString(1, to); ps.setInt(2, id); ps.executeUpdate();
            }
        }
        okMsg(ex, "Leadership handed over to @" + to + ".");
    }

    // ---------------- Groups (study_groups / study_group_members) ----------------
    static void groupsCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String name = get(f, "name"), description = get(f, "description"), category = get(f, "category");
        if (name.isEmpty() || name.length() > 60) { fail(ex, 400, "Give the group a name (up to 60 characters)."); return; }
        try (Connection c = db()) {
            int id;
            try {
                try (PreparedStatement ps = c.prepareStatement(
                        "INSERT INTO study_groups (name, description, category, created_by) VALUES (?,?,?,?)",
                        Statement.RETURN_GENERATED_KEYS)) {
                    ps.setString(1, name); ps.setString(2, description);
                    ps.setString(3, category.isEmpty() ? "General" : category); ps.setString(4, user);
                    ps.executeUpdate();
                    try (ResultSet keys = ps.getGeneratedKeys()) { keys.next(); id = keys.getInt(1); }
                }
            } catch (SQLIntegrityConstraintViolationException e) {
                fail(ex, 400, "A group with that name already exists.");
                return;
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO study_group_members (group_id, username, role) VALUES (?, ?, 'admin')")) {
                ps.setInt(1, id); ps.setString(2, user);
                ps.executeUpdate();
            }
        }
        okMsg(ex, "Group created.");
    }

    // ---- helpers ----
    /** "admin" / "member" for someone in the group, or null if they aren't a member. */
    static String groupRole(Connection c, int gid, String user) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT role FROM study_group_members WHERE group_id = ? AND username = ?")) {
            ps.setInt(1, gid); ps.setString(2, user);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? rs.getString(1) : null; }
        }
    }

    /** {name, created_by} of a group, or null if it doesn't exist. */
    static String[] groupInfo(Connection c, int gid) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT name, created_by FROM study_groups WHERE id = ?")) {
            ps.setInt(1, gid);
            try (ResultSet rs = ps.executeQuery()) { return rs.next() ? new String[]{rs.getString(1), rs.getString(2)} : null; }
        }
    }

    static final String GROUP_SELECT = "SELECT g.id, g.name, g.description, g.category, g.created_by, "
            + "(SELECT COUNT(*) FROM study_group_members WHERE group_id = g.id) AS members, "
            + "(SELECT role FROM study_group_members WHERE group_id = g.id AND username = ?) AS my_role, "
            + "(SELECT COUNT(*) FROM group_join_requests WHERE group_id = g.id AND username = ?) AS my_req, "
            + "(SELECT COUNT(*) FROM group_join_requests WHERE group_id = g.id) AS pending "
            + "FROM study_groups g ";

    static String groupJson(ResultSet rs, String user) throws SQLException {
        String myRole = rs.getString("my_role");
        boolean admin = "admin".equals(myRole);
        return "{\"id\":" + rs.getInt("id")
                + ",\"name\":" + js(rs.getString("name"))
                + ",\"description\":" + js(rs.getString("description"))
                + ",\"category\":" + js(rs.getString("category"))
                + ",\"createdBy\":" + js(rs.getString("created_by"))
                + ",\"members\":" + rs.getInt("members")
                + ",\"joined\":" + (myRole != null)
                + ",\"isAdmin\":" + admin
                + ",\"isCreator\":" + user.equals(rs.getString("created_by"))
                + ",\"requested\":" + (rs.getInt("my_req") > 0)
                + ",\"pending\":" + (admin ? rs.getInt("pending") : 0) + "}";
    }

    static void notifySafe(Connection c, String to, String actor, String type, String targetType, Integer targetId, String msg) {
        try { notify(c, to, actor, type, targetType, targetId, msg); }
        catch (SQLException e) { System.err.println("Couldn't send group notification: " + e.getMessage()); }
    }

    // ---- lists ----
    static void groupsList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"groups\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(GROUP_SELECT + "ORDER BY g.created_at DESC LIMIT 200")) {
            ps.setString(1, user); ps.setString(2, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append(groupJson(rs, user));
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    /** One group, with my role in it (used by the group page). */
    static void groupsGet(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(GROUP_SELECT + "WHERE g.id = ?")) {
            ps.setString(1, user); ps.setString(2, user); ps.setInt(3, id);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) { fail(ex, 404, "That group doesn't exist."); return; }
                send(ex, 200, JSON, "{\"ok\":true,\"group\":" + groupJson(rs, user) + "}");
            }
        }
    }

    // ---- join requests ----
    /** Ask to join (or cancel a pending request). Admins approve it; nobody can join directly. */
    static void groupsRequest(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            String[] info = groupInfo(c, id);
            if (info == null) { fail(ex, 404, "That group doesn't exist."); return; }
            if (groupRole(c, id, user) != null) { fail(ex, 400, "You're already in this group."); return; }
            boolean exists;
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM group_join_requests WHERE group_id = ? AND username = ?")) {
                ps.setInt(1, id); ps.setString(2, user);
                try (ResultSet rs = ps.executeQuery()) { exists = rs.next(); }
            }
            boolean requested;
            if (exists) {
                try (PreparedStatement ps = c.prepareStatement("DELETE FROM group_join_requests WHERE group_id = ? AND username = ?")) {
                    ps.setInt(1, id); ps.setString(2, user); ps.executeUpdate();
                }
                requested = false;
            } else {
                try (PreparedStatement ps = c.prepareStatement("INSERT INTO group_join_requests (group_id, username) VALUES (?, ?)")) {
                    ps.setInt(1, id); ps.setString(2, user); ps.executeUpdate();
                }
                requested = true;
                List<String> admins = new ArrayList<>();
                try (PreparedStatement ps = c.prepareStatement("SELECT username FROM study_group_members WHERE group_id = ? AND role = 'admin'")) {
                    ps.setInt(1, id);
                    try (ResultSet rs = ps.executeQuery()) { while (rs.next()) admins.add(rs.getString(1)); }
                }
                for (String a : admins) notifySafe(c, a, user, "group_request", "group", id, "@" + user + " wants to join " + info[0] + ".");
            }
            send(ex, 200, JSON, "{\"ok\":true,\"requested\":" + requested + "}");
        }
    }

    /** Pending requests for a group (admins only). */
    static void groupsRequests(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            if (!"admin".equals(groupRole(c, id, user))) { fail(ex, 403, "Only group admins can see join requests."); return; }
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"requests\":[");
            String sql = "SELECT r.username, u.name, u.role, u.avatar_path, DATE_FORMAT(r.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                    + "FROM group_join_requests r JOIN users u ON u.username = r.username WHERE r.group_id = ? ORDER BY r.created_at ASC";
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"username\":").append(js(rs.getString("username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"role\":").append(js(rs.getString("role")))
                          .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                          .append(",\"created\":").append(js(rs.getString("created"))).append("}");
                    }
                }
            }
            send(ex, 200, JSON, sb.append("]}").toString());
        }
    }

    /** Approve or decline someone's request (admins only). */
    static void groupsRespond(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String who = get(f, "username").toLowerCase();
        boolean approve = "approve".equals(get(f, "decision"));
        try (Connection c = db()) {
            if (!"admin".equals(groupRole(c, id, user))) { fail(ex, 403, "Only group admins can answer join requests."); return; }
            String[] info = groupInfo(c, id);
            if (info == null) { fail(ex, 404, "That group doesn't exist."); return; }
            int removed;
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM group_join_requests WHERE group_id = ? AND username = ?")) {
                ps.setInt(1, id); ps.setString(2, who); removed = ps.executeUpdate();
            }
            if (removed == 0) { fail(ex, 400, "That request is no longer pending."); return; }
            if (approve) {
                try (PreparedStatement ps = c.prepareStatement("INSERT IGNORE INTO study_group_members (group_id, username) VALUES (?, ?)")) {
                    ps.setInt(1, id); ps.setString(2, who); ps.executeUpdate();
                }
                notifySafe(c, who, user, "group_approved", "group", id, "Your request to join " + info[0] + " was approved.");
            } else {
                notifySafe(c, who, user, "group_declined", null, null, "Your request to join " + info[0] + " wasn't approved.");
            }
        }
        okMsg(ex, approve ? "Approved." : "Declined.");
    }

    // ---- membership ----
    static void groupsLeave(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            String[] info = groupInfo(c, id);
            if (info == null) { fail(ex, 404, "That group doesn't exist."); return; }
            if (user.equals(info[1])) { fail(ex, 400, "You created this group. Delete it instead of leaving."); return; }
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM study_group_members WHERE group_id = ? AND username = ?")) {
                ps.setInt(1, id); ps.setString(2, user); ps.executeUpdate();
            }
        }
        okMsg(ex, "You left the group.");
    }

    /** Members of a group (members only). */
    static void groupsMembers(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            if (groupRole(c, id, user) == null) { fail(ex, 403, "Join the group to see its members."); return; }
            String[] info = groupInfo(c, id);
            String creator = info == null ? "" : info[1];
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"members\":[");
            String sql = "SELECT gm.username, u.name, u.role, u.avatar_path, gm.role AS group_role FROM study_group_members gm "
                    + "JOIN users u ON u.username = gm.username WHERE gm.group_id = ? ORDER BY gm.joined_at ASC";
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"username\":").append(js(rs.getString("username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"role\":").append(js(rs.getString("role")))
                          .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                          .append(",\"groupRole\":").append(js(rs.getString("group_role")))
                          .append(",\"creator\":").append(creator.equals(rs.getString("username"))).append("}");
                    }
                }
            }
            send(ex, 200, JSON, sb.append("]}").toString());
        }
    }

    static void groupsPromote(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String who = get(f, "username").toLowerCase();
        try (Connection c = db()) {
            if (!"admin".equals(groupRole(c, id, user))) { fail(ex, 403, "Only group admins can do that."); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE study_group_members SET role = 'admin' WHERE group_id = ? AND username = ? AND role <> 'admin'")) {
                ps.setInt(1, id); ps.setString(2, who);
                if (ps.executeUpdate() == 0) { fail(ex, 400, "That person isn't a regular member of this group."); return; }
            }
            String[] info = groupInfo(c, id);
            if (info != null) notifySafe(c, who, user, "group_approved", "group", id, "You're now an admin of " + info[0] + ".");
        }
        okMsg(ex, "They're now an admin.");
    }

    static void groupsRemove(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String who = get(f, "username").toLowerCase();
        try (Connection c = db()) {
            if (!"admin".equals(groupRole(c, id, user))) { fail(ex, 403, "Only group admins can remove members."); return; }
            String[] info = groupInfo(c, id);
            if (info == null) { fail(ex, 404, "That group doesn't exist."); return; }
            if (who.equals(user)) { fail(ex, 400, "Use Leave group to remove yourself."); return; }
            if (who.equals(info[1])) { fail(ex, 400, "The group's creator can't be removed."); return; }
            if ("admin".equals(groupRole(c, id, who)) && !user.equals(info[1])) { fail(ex, 403, "Only the creator can remove another admin."); return; }
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM study_group_members WHERE group_id = ? AND username = ?")) {
                ps.setInt(1, id); ps.setString(2, who);
                if (ps.executeUpdate() == 0) { fail(ex, 404, "That person isn't in this group."); return; }
            }
        }
        okMsg(ex, "Removed from the group.");
    }

    /** Only the creator can delete a group. Its requests and chat go with it. */
    static void groupsDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "id"), -1);
        try (Connection c = db()) {
            String[] info = groupInfo(c, id);
            if (info == null || !user.equals(info[1])) { fail(ex, 400, "Not found, or it isn't yours to delete."); return; }
            for (String table : new String[]{"group_join_requests", "group_messages"}) {
                try (PreparedStatement ps = c.prepareStatement("DELETE FROM " + table + " WHERE group_id = ?")) {
                    ps.setInt(1, id); ps.executeUpdate();
                }
            }
        }
        deleteOwned(ex, f, user, "study_groups", "id", "created_by");
    }

    // ---- group chat (members only) ----
    static void groupChatList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        try (Connection c = db()) {
            if (groupRole(c, id, user) == null) { fail(ex, 403, "Join the group to see its chat."); return; }
            String sql = "SELECT * FROM (SELECT m.id, m.sender_username, u.name, u.avatar_path, m.content, "
                    + "DATE_FORMAT(m.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                    + "FROM group_messages m JOIN users u ON u.username = m.sender_username "
                    + "WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 200) t ORDER BY id ASC";
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"messages\":[");
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"id\":").append(rs.getInt("id"))
                          .append(",\"username\":").append(js(rs.getString("sender_username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                          .append(",\"content\":").append(js(rs.getString("content")))
                          .append(",\"created\":").append(js(rs.getString("created")))
                          .append(",\"mine\":").append(user.equals(rs.getString("sender_username"))).append("}");
                    }
                }
            }
            send(ex, 200, JSON, sb.append("]}").toString());
        }
    }

    static void groupChatSend(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "groupId"), -1);
        String content = get(f, "content");
        if (content.isEmpty() || content.length() > 2000) { fail(ex, 400, "A message must be 1-2000 characters."); return; }
        try (Connection c = db()) {
            if (groupRole(c, id, user) == null) { fail(ex, 403, "Join the group to chat in it."); return; }
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO group_messages (group_id, sender_username, content) VALUES (?, ?, ?)")) {
                ps.setInt(1, id); ps.setString(2, user); ps.setString(3, content); ps.executeUpdate();
            }
        }
        okMsg(ex, "Sent.");
    }

    /** Delete a chat message: your own, or any message if you're a group admin. */
    static void groupChatDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "id"), -1);
        try (Connection c = db()) {
            int gid = -1; String sender = null;
            try (PreparedStatement ps = c.prepareStatement("SELECT group_id, sender_username FROM group_messages WHERE id = ?")) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) { if (rs.next()) { gid = rs.getInt(1); sender = rs.getString(2); } }
            }
            if (sender == null) { fail(ex, 404, "Message not found."); return; }
            String role = groupRole(c, gid, user);
            if (role == null || !(user.equals(sender) || "admin".equals(role))) { fail(ex, 403, "You can't delete that message."); return; }
            try (PreparedStatement ps = c.prepareStatement("DELETE FROM group_messages WHERE id = ?")) {
                ps.setInt(1, id); ps.executeUpdate();
            }
        }
        okMsg(ex, "Message deleted.");
    }

    // ---------------- Lost & found (lost_found_items) ----------------
    static void lostFoundCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String type = get(f, "type"), item = get(f, "item"), location = get(f, "location"),
               description = get(f, "description"), date = get(f, "date");
        String photo = get(f, "photo");
        if (!type.equals("lost") && !type.equals("found")) { fail(ex, 400, "Choose lost or found."); return; }
        if (item.isEmpty() || item.length() > 80) { fail(ex, 400, "Name the item (up to 80 characters)."); return; }
        if (location.length() > 120) { fail(ex, 400, "Location is too long (up to 120 characters)."); return; }
        if (description.length() > 500) { fail(ex, 400, "Description is too long (up to 500 characters)."); return; }
        if (!date.isEmpty() && !date.matches("\\d{4}-\\d{2}-\\d{2}")) { fail(ex, 400, "That date doesn't look right."); return; }
        String imagePath;
        try {
            imagePath = photo.isEmpty() ? null : saveImage(photo, "lostfound");
        } catch (IllegalArgumentException e) {
            fail(ex, 400, e.getMessage());
            return;
        }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "INSERT INTO lost_found_items (username, type, item_name, description, location, item_date, image_path) VALUES (?,?,?,?,?,?,?)")) {
            ps.setString(1, user); ps.setString(2, type); ps.setString(3, item);
            ps.setString(4, description); ps.setString(5, location);
            if (date.isEmpty()) ps.setNull(6, Types.DATE); else ps.setString(6, date);
            ps.setString(7, imagePath);
            ps.executeUpdate();
        }
        okMsg(ex, "Posted.");
    }

    static void lostFoundList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT lf.id, lf.username, u.name, u.avatar_path, lf.type, lf.item_name, lf.location, lf.description, lf.status, lf.image_path, "
                + "DATE_FORMAT(lf.item_date, '%Y-%m-%d') AS item_date, "
                + "DATE_FORMAT(lf.created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                + "FROM lost_found_items lf JOIN users u ON u.username = lf.username ORDER BY lf.created_at DESC LIMIT 50";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"items\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"username\":").append(js(rs.getString("username")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                      .append(",\"type\":").append(js(rs.getString("type")))
                      .append(",\"item\":").append(js(rs.getString("item_name")))
                      .append(",\"location\":").append(js(rs.getString("location")))
                      .append(",\"description\":").append(js(rs.getString("description")))
                      .append(",\"image\":").append(js(rs.getString("image_path")))
                      .append(",\"date\":").append(js(rs.getString("item_date")))
                      .append(",\"status\":").append(js(rs.getString("status")))
                      .append(",\"created\":").append(js(rs.getString("created")))
                      .append(",\"mine\":").append(rs.getString("username").equals(user))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void lostFoundResolve(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "id"), -1);
        if (id < 0) { fail(ex, 400, "Missing item."); return; }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE lost_found_items SET status = 'resolved' WHERE id = ? AND username = ?")) {
            ps.setInt(1, id); ps.setString(2, user);
            int n = ps.executeUpdate();
            if (n == 0) { fail(ex, 400, "Not found, or it isn't yours."); return; }
        }
        okMsg(ex, "Marked as resolved.");
    }

    static void lostFoundDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        deleteOwned(ex, f, user, "lost_found_items", "id", "username", "image_path");
    }

    // ---------------- Rides (rides / ride_requests) ----------------
    static void ridesCreate(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String type = get(f, "type"), from = get(f, "from"), to = get(f, "to"), date = get(f, "date"),
               time = get(f, "time"), seatsStr = get(f, "seats"), notes = get(f, "notes");
        if (!type.equals("offer") && !type.equals("request")) { fail(ex, 400, "Choose offer or request."); return; }
        if (from.isEmpty() || to.isEmpty()) { fail(ex, 400, "Fill in where you're coming from and going to."); return; }
        if (date.isEmpty()) { fail(ex, 400, "Pick a date."); return; }
        Integer seats = null;
        if (!seatsStr.isEmpty()) {
            try { seats = Integer.parseInt(seatsStr); } catch (NumberFormatException e) { fail(ex, 400, "Seats must be a number."); return; }
        }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "INSERT INTO rides (username, type, from_location, to_location, ride_date, ride_time, seats_available, notes) VALUES (?,?,?,?,?,?,?,?)")) {
            ps.setString(1, user); ps.setString(2, type); ps.setString(3, from); ps.setString(4, to); ps.setString(5, date);
            if (time.isEmpty()) ps.setNull(6, Types.TIME); else ps.setString(6, time);
            if (seats == null) ps.setNull(7, Types.INTEGER); else ps.setInt(7, seats);
            ps.setString(8, notes);
            ps.executeUpdate();
        }
        okMsg(ex, "Ride posted.");
    }

    static void ridesList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT r.id, r.username, u.name, r.type, r.from_location, r.to_location, "
                + "DATE_FORMAT(r.ride_date, '%Y-%m-%d') AS ride_date, DATE_FORMAT(r.ride_time, '%H:%i') AS ride_time, "
                + "r.seats_available, r.notes, r.status, "
                + "(SELECT COUNT(*) FROM ride_requests WHERE ride_id = r.id AND status = 'accepted') AS accepted_count, "
                + "(SELECT status FROM ride_requests WHERE ride_id = r.id AND username = ?) AS my_status "
                + "FROM rides r JOIN users u ON u.username = r.username ORDER BY r.ride_date ASC, r.id DESC LIMIT 50";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"rides\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    int seats = rs.getInt("seats_available");
                    boolean hasSeats = !rs.wasNull();
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"username\":").append(js(rs.getString("username")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"type\":").append(js(rs.getString("type")))
                      .append(",\"from\":").append(js(rs.getString("from_location")))
                      .append(",\"to\":").append(js(rs.getString("to_location")))
                      .append(",\"date\":").append(js(rs.getString("ride_date")))
                      .append(",\"time\":").append(js(rs.getString("ride_time")))
                      .append(",\"seats\":").append(hasSeats ? String.valueOf(seats) : "null")
                      .append(",\"notes\":").append(js(rs.getString("notes")))
                      .append(",\"status\":").append(js(rs.getString("status")))
                      .append(",\"acceptedCount\":").append(rs.getInt("accepted_count"))
                      .append(",\"myStatus\":").append(js(rs.getString("my_status")))
                      .append(",\"mine\":").append(rs.getString("username").equals(user))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    /** A rider asks to join a ride, or withdraws their own request (both via this one endpoint). */
    static void ridesRequest(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "rideId"), -1);
        if (id < 0) { fail(ex, 400, "Missing ride."); return; }
        try (Connection c = db()) {
            String owner = ownerOf(c, "rides", "id", "username", id);
            if (owner == null) { fail(ex, 400, "Ride not found."); return; }
            if (owner.equals(user)) { fail(ex, 400, "That's your own ride."); return; }
            boolean nowRequested = toggle(c, "ride_requests", "ride_id", String.valueOf(id), "username", user);
            if (nowRequested) notify(c, owner, user, "ride_request", "ride", id, "@" + user + " wants to join your ride.");
            send(ex, 200, JSON, "{\"ok\":true,\"requested\":" + nowRequested + "}");
        }
    }

    /** The ride's owner accepts or declines someone's request. */
    static void ridesRespond(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "rideId"), -1);
        String requester = get(f, "username").toLowerCase();
        String decision = get(f, "decision");
        if (id < 0 || requester.isEmpty()) { fail(ex, 400, "Missing ride or username."); return; }
        if (!decision.equals("accepted") && !decision.equals("declined")) { fail(ex, 400, "Decision must be accepted or declined."); return; }
        try (Connection c = db()) {
            String owner = ownerOf(c, "rides", "id", "username", id);
            if (owner == null || !owner.equals(user)) { fail(ex, 400, "Only the ride's owner can do that."); return; }
            try (PreparedStatement ps = c.prepareStatement("UPDATE ride_requests SET status = ? WHERE ride_id = ? AND username = ?")) {
                ps.setString(1, decision); ps.setInt(2, id); ps.setString(3, requester);
                int n = ps.executeUpdate();
                if (n == 0) { fail(ex, 400, "That request doesn't exist."); return; }
            }
            notify(c, requester, user, "ride_response", "ride", id, "@" + user + " " + decision + " your ride request.");
        }
        okMsg(ex, "Response saved.");
    }

    /** The people who've asked to join one of my rides, so I can accept or decline them. */
    static void ridesRequests(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "rideId"), -1);
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"requests\":[");
        if (id >= 0) {
            String sql = "SELECT rr.username, u.name, rr.status FROM ride_requests rr "
                    + "JOIN users u ON u.username = rr.username WHERE rr.ride_id = ? ORDER BY rr.created_at ASC";
            try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setInt(1, id);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"username\":").append(js(rs.getString("username")))
                          .append(",\"name\":").append(js(rs.getString("name")))
                          .append(",\"status\":").append(js(rs.getString("status"))).append("}");
                    }
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    static void ridesClose(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = toInt(get(f, "id"), -1);
        if (id < 0) { fail(ex, 400, "Missing ride."); return; }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE rides SET status = 'closed' WHERE id = ? AND username = ?")) {
            ps.setInt(1, id); ps.setString(2, user);
            int n = ps.executeUpdate();
            if (n == 0) { fail(ex, 400, "Not found, or it isn't yours."); return; }
        }
        okMsg(ex, "Ride closed.");
    }

    static void ridesDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        deleteOwned(ex, f, user, "rides", "id", "username");
    }

    // ---------------- Notifications ----------------
    static void notificationsList(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT id, actor_username, type, target_type, target_id, message, is_read, "
                + "DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                + "FROM notifications WHERE username = ? ORDER BY created_at DESC LIMIT 40";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"notifications\":[");
        int unread = 0;
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    boolean read = rs.getBoolean("is_read");
                    if (!read) unread++;
                    Object targetIdObj = rs.getObject("target_id");
                    sb.append("{\"id\":").append(rs.getInt("id"))
                      .append(",\"actor\":").append(js(rs.getString("actor_username")))
                      .append(",\"type\":").append(js(rs.getString("type")))
                      .append(",\"targetType\":").append(js(rs.getString("target_type")))
                      .append(",\"targetId\":").append(targetIdObj == null ? "null" : rs.getInt("target_id"))
                      .append(",\"message\":").append(js(rs.getString("message")))
                      .append(",\"read\":").append(read)
                      .append(",\"created\":").append(js(rs.getString("created")))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("],\"unread\":").append(unread).append("}").toString());
    }

    static void notificationsRead(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE notifications SET is_read = 1 WHERE username = ? AND is_read = 0")) {
            ps.setString(1, user);
            ps.executeUpdate();
        }
        okMsg(ex, "Marked as read.");
    }

    // ---------------- Direct messages ----------------
    static void messagesSend(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String to = get(f, "to").toLowerCase();
        String content = get(f, "content");
        if (to.isEmpty()) { fail(ex, 400, "Missing recipient."); return; }
        if (to.equals(user)) { fail(ex, 400, "You can't message yourself."); return; }
        if (content.isEmpty() || content.length() > 2000) { fail(ex, 400, "A message must be 1-2000 characters."); return; }
        try (Connection c = db()) {
            try (PreparedStatement ps = c.prepareStatement("SELECT 1 FROM users WHERE username = ?")) {
                ps.setString(1, to);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) { fail(ex, 400, "That user doesn't exist."); return; }
                }
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "INSERT INTO messages (sender_username, recipient_username, content) VALUES (?, ?, ?)")) {
                ps.setString(1, user); ps.setString(2, to); ps.setString(3, content);
                ps.executeUpdate();
            }
        }
        okMsg(ex, "Sent.");
    }

    /** One row per person I've exchanged messages with, newest conversation first. */
    static void messagesConversations(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String sql = "SELECT t.partner, u.name, u.role, u.avatar_path, t.last_content, "
                + "DATE_FORMAT(t.last_created, '%Y-%m-%dT%H:%i:%sZ') AS last_created, t.last_sender, t.last_unsent, "
                + "COALESCE(uc.unread, 0) AS unread "
                + "FROM ( "
                + "  SELECT partner, content AS last_content, created_at AS last_created, sender_username AS last_sender, unsent AS last_unsent, "
                + "         ROW_NUMBER() OVER (PARTITION BY partner ORDER BY created_at DESC) AS rn "
                + "  FROM ( "
                + "    SELECT sender_username, recipient_username, content, created_at, unsent, "
                + "           CASE WHEN sender_username = ? THEN recipient_username ELSE sender_username END AS partner "
                + "    FROM messages WHERE (sender_username = ? AND hidden_sender = 0) OR (recipient_username = ? AND hidden_recipient = 0) "
                + "  ) x "
                + ") t "
                + "JOIN users u ON u.username = t.partner "
                + "LEFT JOIN ( "
                + "  SELECT sender_username AS p, COUNT(*) AS unread FROM messages "
                + "  WHERE recipient_username = ? AND is_read = 0 AND unsent = 0 AND hidden_recipient = 0 GROUP BY sender_username "
                + ") uc ON uc.p = t.partner "
                + "WHERE t.rn = 1 ORDER BY t.last_created DESC";
        StringBuilder sb = new StringBuilder("{\"ok\":true,\"conversations\":[");
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, user); ps.setString(2, user); ps.setString(3, user); ps.setString(4, user);
            try (ResultSet rs = ps.executeQuery()) {
                boolean first = true;
                while (rs.next()) {
                    if (!first) sb.append(","); first = false;
                    sb.append("{\"username\":").append(js(rs.getString("partner")))
                      .append(",\"name\":").append(js(rs.getString("name")))
                      .append(",\"role\":").append(js(rs.getString("role")))
                      .append(",\"avatar\":").append(js(rs.getString("avatar_path")))
                      .append(",\"lastContent\":").append(js(rs.getString("last_content")))
                      .append(",\"lastCreated\":").append(js(rs.getString("last_created")))
                      .append(",\"lastMine\":").append(user.equals(rs.getString("last_sender")))
                      .append(",\"lastUnsent\":").append(rs.getInt("last_unsent") == 1)
                      .append(",\"unread\":").append(rs.getInt("unread"))
                      .append("}");
                }
            }
        }
        send(ex, 200, JSON, sb.append("]}").toString());
    }

    /** The full back-and-forth with one other user, oldest first. Marks their messages to me as read. */
    static void messagesThread(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String with = get(f, "with").toLowerCase();
        if (with.isEmpty()) { fail(ex, 400, "Missing conversation partner."); return; }
        try (Connection c = db()) {
            String name = null, role = null, avatar = null;
            try (PreparedStatement ps = c.prepareStatement("SELECT name, role, avatar_path FROM users WHERE username = ?")) {
                ps.setString(1, with);
                try (ResultSet rs = ps.executeQuery()) {
                    if (!rs.next()) { fail(ex, 404, "That user doesn't exist."); return; }
                    name = rs.getString("name"); role = rs.getString("role"); avatar = rs.getString("avatar_path");
                }
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE messages SET is_read = 1 WHERE sender_username = ? AND recipient_username = ? AND is_read = 0")) {
                ps.setString(1, with); ps.setString(2, user);
                ps.executeUpdate();
            }
            String sql = "SELECT id, sender_username, content, unsent, edited, is_read, "
                    + "(is_read = 0 AND unsent = 0 AND created_at >= (NOW() - INTERVAL 30 MINUTE)) AS can_edit, "
                    + "DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%sZ') AS created "
                    + "FROM messages WHERE (sender_username = ? AND recipient_username = ? AND hidden_sender = 0) "
                    + "OR (sender_username = ? AND recipient_username = ? AND hidden_recipient = 0) ORDER BY created_at ASC LIMIT 300";
            StringBuilder sb = new StringBuilder("{\"ok\":true,\"name\":").append(js(name))
                    .append(",\"role\":").append(js(role)).append(",\"avatar\":").append(js(avatar)).append(",\"messages\":[");
            try (PreparedStatement ps = c.prepareStatement(sql)) {
                ps.setString(1, user); ps.setString(2, with); ps.setString(3, with); ps.setString(4, user);
                try (ResultSet rs = ps.executeQuery()) {
                    boolean first = true;
                    while (rs.next()) {
                        if (!first) sb.append(","); first = false;
                        sb.append("{\"id\":").append(rs.getInt("id"))
                          .append(",\"mine\":").append(user.equals(rs.getString("sender_username")))
                          .append(",\"content\":").append(js(rs.getInt("unsent") == 1 ? "" : rs.getString("content")))
                          .append(",\"unsent\":").append(rs.getInt("unsent") == 1)
                          .append(",\"edited\":").append(rs.getInt("edited") == 1)
                          .append(",\"read\":").append(rs.getInt("is_read") == 1)
                          .append(",\"canEdit\":").append(rs.getInt("can_edit") == 1)
                          .append(",\"created\":").append(js(rs.getString("created")))
                          .append("}");
                    }
                }
            }
            send(ex, 200, JSON, sb.append("]}").toString());
        }
    }

    static void messagesUnread(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int unread = 0;
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "SELECT COUNT(*) AS n FROM messages WHERE recipient_username = ? AND is_read = 0 AND unsent = 0 AND hidden_recipient = 0")) {
            ps.setString(1, user);
            try (ResultSet rs = ps.executeQuery()) { if (rs.next()) unread = rs.getInt("n"); }
        }
        send(ex, 200, JSON, "{\"ok\":true,\"unread\":" + unread + "}");
    }

    /** Unsend: the sender removes a message for both people. A placeholder stays in the thread. */
    static void messagesUnsend(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = parseId(get(f, "id"));
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE messages SET unsent = 1, edited = 0, content = '' WHERE id = ? AND sender_username = ?")) {
            ps.setInt(1, id); ps.setString(2, user);
            if (ps.executeUpdate() == 0) { fail(ex, 404, "You can only unsend your own messages."); return; }
        }
        okMsg(ex, "Message unsent.");
    }

    /** Edit: only the sender, only while the other person hasn't read it, and only for 30 minutes after sending. */
    static void messagesEdit(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = parseId(get(f, "id"));
        String content = get(f, "content");
        if (content.isEmpty() || content.length() > 2000) { fail(ex, 400, "A message must be 1-2000 characters."); return; }
        try (Connection c = db()) {
            int unsent = 0, read = 0; long age = 0; boolean found = false;
            try (PreparedStatement ps = c.prepareStatement(
                    "SELECT unsent, is_read, TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age FROM messages "
                    + "WHERE id = ? AND sender_username = ?")) {
                ps.setInt(1, id); ps.setString(2, user);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) { found = true; unsent = rs.getInt("unsent"); read = rs.getInt("is_read"); age = rs.getLong("age"); }
                }
            }
            if (!found) { fail(ex, 404, "You can only edit your own messages."); return; }
            if (unsent == 1) { fail(ex, 400, "That message was unsent."); return; }
            if (read == 1) { fail(ex, 400, "You can't edit a message after it has been seen."); return; }
            if (age > 30 * 60) { fail(ex, 400, "You can only edit a message within 30 minutes of sending it."); return; }
            try (PreparedStatement ps = c.prepareStatement(
                    "UPDATE messages SET content = ?, edited = 1 WHERE id = ? AND sender_username = ? AND unsent = 0 AND is_read = 0")) {
                ps.setString(1, content); ps.setInt(2, id); ps.setString(3, user);
                if (ps.executeUpdate() == 0) { fail(ex, 400, "You can't edit a message after it has been seen."); return; }
            }
        }
        okMsg(ex, "Message edited.");
    }

    /** Delete for me: hides one message from my side only. */
    static void messagesDelete(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        int id = parseId(get(f, "id"));
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE messages SET hidden_sender = IF(sender_username = ?, 1, hidden_sender), "
                + "hidden_recipient = IF(recipient_username = ?, 1, hidden_recipient) "
                + "WHERE id = ? AND (sender_username = ? OR recipient_username = ?)")) {
            ps.setString(1, user); ps.setString(2, user); ps.setInt(3, id); ps.setString(4, user); ps.setString(5, user);
            if (ps.executeUpdate() == 0) { fail(ex, 404, "Message not found."); return; }
        }
        okMsg(ex, "Message deleted.");
    }

    /** Delete conversation: hides the whole chat from my side only. */
    static void messagesClear(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String with = get(f, "with").toLowerCase();
        if (with.isEmpty()) { fail(ex, 400, "Missing conversation partner."); return; }
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement(
                "UPDATE messages SET hidden_sender = IF(sender_username = ?, 1, hidden_sender), "
                + "hidden_recipient = IF(recipient_username = ?, 1, hidden_recipient) "
                + "WHERE (sender_username = ? AND recipient_username = ?) OR (sender_username = ? AND recipient_username = ?)")) {
            ps.setString(1, user); ps.setString(2, user);
            ps.setString(3, user); ps.setString(4, with); ps.setString(5, with); ps.setString(6, user);
            ps.executeUpdate();
        }
        okMsg(ex, "Conversation deleted.");
    }

    static int parseId(String s) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return -1; }
    }

    // ---------------- Forgot password (security question) ----------------
    static void forgotQuestion(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String username = get(f, "username").toLowerCase();
        try (Connection c = db(); PreparedStatement ps = c.prepareStatement("SELECT security_question FROM users WHERE username = ?")) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next() || rs.getString(1) == null) {
                    fail(ex, 400, "We couldn't find a security question for that username.");
                    return;
                }
                send(ex, 200, JSON, "{\"ok\":true,\"question\":" + js(rs.getString(1)) + "}");
            }
        }
    }

    static boolean resetBlocked(String key, int limit) {
        long[] e = RESET_FAILS.get(key);
        return e != null && System.currentTimeMillis() - e[1] < RESET_WINDOW_MS && e[0] >= limit;
    }

    static void resetFailed(String key) {
        long now = System.currentTimeMillis();
        RESET_FAILS.compute(key, (k, e) -> (e == null || now - e[1] >= RESET_WINDOW_MS) ? new long[]{1, now} : new long[]{e[0] + 1, e[1]});
        if (RESET_FAILS.size() > 20000) RESET_FAILS.entrySet().removeIf(en -> now - en.getValue()[1] >= RESET_WINDOW_MS);
    }

    static void forgotReset(HttpExchange ex, Map<String, String> f, String user) throws Exception {
        String username = get(f, "username").toLowerCase();
        String answer = get(f, "answer").toLowerCase();
        String next = f.getOrDefault("newPassword", "");
        if (next.length() < 6) { fail(ex, 400, "New password must be at least 6 characters."); return; }
        String kUser = "ru:" + username, kIp = "rip:" + clientIp(ex);
        if (resetBlocked(kUser, RESET_MAX_PER_USER) || resetBlocked(kIp, RESET_MAX_PER_IP)) {
            fail(ex, 429, "Too many wrong answers. Please wait about 15 minutes and try again.");
            return;
        }
        try (Connection c = db()) {
            String stored = null;
            try (PreparedStatement ps = c.prepareStatement("SELECT security_answer_hash FROM users WHERE username = ?")) {
                ps.setString(1, username);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) stored = rs.getString(1);
                }
            }
            if (stored == null || !verify(answer, stored)) {
                resetFailed(kUser); resetFailed(kIp);
                fail(ex, 400, "That answer doesn't match.");
                return;
            }
            setColumn(c, "password_hash", hash(next), username);
        }
        RESET_FAILS.remove(kUser);
        SESSIONS.values().removeIf(s -> s.user.equals(username));
        okMsg(ex, "Password reset. You can log in now.");
    }

    // ---------------- Database helpers ----------------
    static boolean passwordOk(Connection c, String username, String password) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT password_hash FROM users WHERE username = ?")) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() && verify(password, rs.getString(1));
            }
        }
    }

    /** Sets one column for one user. Only ever called with fixed column names from this file. */
    static void setColumn(Connection c, String column, String value, String username) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("UPDATE users SET " + column + " = ? WHERE username = ?")) {
            ps.setString(1, value); ps.setString(2, username);
            ps.executeUpdate();
        }
    }

    static int toInt(String s, int def) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return def; }
    }

    /**
     * Flips a row in a two-column join/reaction table (a like, a follow, a group join...):
     * deletes it if it exists, inserts it if it doesn't. Returns true if the row now exists.
     * table/colA/colB must always be fixed string literals from this file, never user input.
     */
    static boolean toggle(Connection c, String table, String colA, String valA, String colB, String valB) throws SQLException {
        String checkSql = "SELECT 1 FROM " + table + " WHERE " + colA + " = ? AND " + colB + " = ?";
        try (PreparedStatement ps = c.prepareStatement(checkSql)) {
            ps.setString(1, valA); ps.setString(2, valB);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    try (PreparedStatement del = c.prepareStatement(
                            "DELETE FROM " + table + " WHERE " + colA + " = ? AND " + colB + " = ?")) {
                        del.setString(1, valA); del.setString(2, valB);
                        del.executeUpdate();
                    }
                    return false;
                } else {
                    try (PreparedStatement ins = c.prepareStatement(
                            "INSERT INTO " + table + " (" + colA + ", " + colB + ") VALUES (?, ?)")) {
                        ins.setString(1, valA); ins.setString(2, valB);
                        ins.executeUpdate();
                    }
                    return true;
                }
            }
        }
    }

    /** Looks up who owns a row, so an action on it (like, comment, delete) can be checked or can notify them. */
    static String ownerOf(Connection c, String table, String idCol, String ownerCol, int id) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT " + ownerCol + " FROM " + table + " WHERE " + idCol + " = ?")) {
            ps.setInt(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getString(1) : null;
            }
        }
    }

    /** Deletes a row only if it belongs to the caller (used by every "delete my post/event/..." endpoint). */
    static void deleteOwned(HttpExchange ex, Map<String, String> f, String user, String table, String idCol, String ownerCol) throws Exception {
        deleteOwned(ex, f, user, table, idCol, ownerCol, null);
    }

    /** Same as above, but if imageCol is given, the row's saved image file is removed from disk too. */
    static void deleteOwned(HttpExchange ex, Map<String, String> f, String user, String table, String idCol, String ownerCol, String imageCol) throws Exception {
        int id = toInt(get(f, "id"), -1);
        if (id < 0) { fail(ex, 400, "Missing id."); return; }
        String imagePath = null;
        try (Connection c = db()) {
            if (imageCol != null) {
                try (PreparedStatement sel = c.prepareStatement(
                        "SELECT " + imageCol + " FROM " + table + " WHERE " + idCol + " = ? AND " + ownerCol + " = ?")) {
                    sel.setInt(1, id); sel.setString(2, user);
                    try (ResultSet rs = sel.executeQuery()) {
                        if (rs.next()) imagePath = rs.getString(1);
                    }
                }
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "DELETE FROM " + table + " WHERE " + idCol + " = ? AND " + ownerCol + " = ?")) {
                ps.setInt(1, id); ps.setString(2, user);
                int n = ps.executeUpdate();
                if (n == 0) { fail(ex, 400, "Not found, or it isn't yours to delete."); return; }
            }
        }
        deleteImage(imagePath);
        okMsg(ex, "Deleted.");
    }

    // ---------------- @mentions ----------------
    // "@name" counts when it isn't glued to a letter, digit, "." or "_" before it (so emails don't match).
    static final Pattern MENTION = Pattern.compile("(?<![A-Za-z0-9._])@([A-Za-z0-9._]{1,30})");

    /** Sends a "mentioned you" notification to every real user @mentioned in text, except the author and
     *  anyone in skip. Up to 10 people per post/comment. Never throws, so a notification problem can't
     *  make a post or comment fail after it was already saved. */
    static void notifyMentions(Connection c, String text, String actor, String targetType, int targetId,
                               String where, Set<String> skip, int groupId) {
        try {
            Set<String> names = new LinkedHashSet<>();
            Matcher m = MENTION.matcher(text);
            while (m.find() && names.size() < 10) {
                String n = m.group(1).toLowerCase();
                while (n.endsWith(".")) n = n.substring(0, n.length() - 1);   // "@sam." at the end of a sentence
                if (!n.isEmpty()) names.add(n);
            }
            names.remove(actor);
            if (skip != null) names.removeAll(skip);
            for (String n : names) {
                boolean exists;
                // In a group, only members are notified (so private group chatter doesn't reach outsiders).
                String existsSql = groupId >= 0
                        ? "SELECT 1 FROM study_group_members WHERE group_id = ? AND username = ?"
                        : "SELECT 1 FROM users WHERE username = ?";
                try (PreparedStatement ps = c.prepareStatement(existsSql)) {
                    if (groupId >= 0) { ps.setInt(1, groupId); ps.setString(2, n); }
                    else ps.setString(1, n);
                    try (ResultSet rs = ps.executeQuery()) { exists = rs.next(); }
                }
                if (exists) notify(c, n, actor, "mention", targetType, targetId, "@" + actor + " mentioned you in " + where + ".");
            }
        } catch (SQLException e) {
            System.err.println("Couldn't send mention notifications: " + e.getMessage());
        }
    }

    /** The group a post was made in, or -1 for a main-feed post (or if it can't be found). */
    static int groupOfPost(Connection c, int postId) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement("SELECT group_id FROM posts WHERE id = ?")) {
            ps.setInt(1, postId);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) { int g = rs.getInt(1); return rs.wasNull() ? -1 : g; }
            }
        }
        return -1;
    }

    /** Writes one notification for username, caused by actorUsername (null for none). */
    static void notify(Connection c, String username, String actorUsername, String type,
                        String targetType, Integer targetId, String message) throws SQLException {
        String sql = "INSERT INTO notifications (username, actor_username, type, target_type, target_id, message) VALUES (?,?,?,?,?,?)";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username);
            ps.setString(2, actorUsername);
            ps.setString(3, type);
            if (targetType == null) ps.setNull(4, Types.VARCHAR); else ps.setString(4, targetType);
            if (targetId == null) ps.setNull(5, Types.INTEGER); else ps.setInt(5, targetId);
            ps.setString(6, message);
            ps.executeUpdate();
        }
    }

    static String profileJson(ResultSet rs) throws SQLException {
        return "{\"username\":" + js(rs.getString("username")) + ",\"role\":" + js(rs.getString("role"))
                + ",\"gender\":" + js(rs.getString("gender")) + ",\"name\":" + js(rs.getString("name")) + ",\"detail\":" + js(rs.getString("detail"))
                + ",\"bio\":" + js(rs.getString("bio")) + ",\"course\":" + js(rs.getString("course"))
                + ",\"year\":" + js(rs.getString("year_of_study")) + ",\"interests\":" + js(rs.getString("interests"))
                + ",\"avatarPath\":" + js(rs.getString("avatar_path"))
                + ",\"hasQuestion\":" + (rs.getString("security_question") != null)
                + ",\"onboarded\":" + rs.getBoolean("onboarded") + "}";
    }

    // ---------------- Passwords (PBKDF2, built into Java) and tokens ----------------
    static String hash(String password) {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt) + ":" + Base64.getEncoder().encodeToString(pbkdf2(password, salt));
    }

    static boolean verify(String password, String stored) {
        String[] parts = stored.split(":");
        byte[] salt = Base64.getDecoder().decode(parts[0]);
        byte[] expected = Base64.getDecoder().decode(parts[1]);
        return MessageDigest.isEqual(expected, pbkdf2(password, salt));
    }

    static byte[] pbkdf2(String password, byte[] salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 120_000, 256);
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new RuntimeException(e);
        }
    }

    static String newToken() {
        byte[] b = new byte[32];
        new SecureRandom().nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    // ---------------- Static files ----------------
    static void handleStatic(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/login.html";
        Path file = WEB_ROOT.resolve(path.substring(1)).normalize();
        if (!file.startsWith(WEB_ROOT) || !Files.isRegularFile(file)) {
            send(ex, 404, "text/plain", "Not found");
            return;
        }
        String name = file.getFileName().toString();
        String lower = name.toLowerCase();
        String type = name.endsWith(".html") ? "text/html; charset=utf-8"
                    : name.endsWith(".css")  ? "text/css; charset=utf-8"
                    : name.endsWith(".js")   ? "application/javascript; charset=utf-8"
                    : lower.endsWith(".png") ? "image/png"
                    : (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) ? "image/jpeg"
                    : lower.endsWith(".webp") ? "image/webp"
                    : lower.endsWith(".gif") ? "image/gif"
                    : "application/octet-stream";
        byte[] data = Files.readAllBytes(file);
        if (name.endsWith(".html")) ex.getResponseHeaders().set("Content-Security-Policy", cspFor(new String(data, StandardCharsets.UTF_8)));
        send(ex, 200, type, data);
    }

    // ---------------- Small helpers ----------------
    static Map<String, String> parseForm(String body) throws UnsupportedEncodingException {
        Map<String, String> map = new HashMap<>();
        for (String pair : body.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv.length == 2)
                map.put(URLDecoder.decode(kv[0], "UTF-8"), URLDecoder.decode(kv[1], "UTF-8"));
        }
        return map;
    }

    static String get(Map<String, String> f, String key) { return clean(f.getOrDefault(key, "")); }

    /** Turns control characters (like new lines) into spaces and trims. */
    static String clean(String s) { return s.replaceAll("\\p{Cntrl}", " ").trim(); }

    static String esc(String s) {
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "").replace("\t", "\\t");
    }

    /** A JSON string value (null becomes empty). */
    static String js(String s) { return "\"" + esc(s == null ? "" : s) + "\""; }

    static void okMsg(HttpExchange ex, String message) throws IOException {
        send(ex, 200, JSON, "{\"ok\":true,\"message\":" + js(message) + "}");
    }

    static void fail(HttpExchange ex, int code, String message) throws IOException {
        send(ex, code, JSON, "{\"ok\":false,\"message\":" + js(message) + "}");
    }

    static void expired(HttpExchange ex) throws IOException {
        send(ex, 401, JSON, "{\"ok\":false,\"expired\":true,\"message\":\"Please log in again.\"}");
    }

    static void send(HttpExchange ex, int code, String type, String text) throws IOException {
        send(ex, code, type, text.getBytes(StandardCharsets.UTF_8));
    }

    // ---------------- Security headers ----------------
    // Sent on every response. HTML pages also get a Content-Security-Policy built per page (see cspFor).
    static void securityHeaders(HttpExchange ex, String type) {
        var h = ex.getResponseHeaders();
        h.set("X-Content-Type-Options", "nosniff");
        h.set("X-Frame-Options", "DENY");
        // Not "no-referrer": YouTube embeds refuse to play without a referrer.
        h.set("Referrer-Policy", "strict-origin-when-cross-origin");
        h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
        if (TRUST_PROXY) h.set("Strict-Transport-Security", "max-age=15552000");   // only when we sit behind an HTTPS proxy
        if (type.startsWith("application/json") && !h.containsKey("Content-Security-Policy"))
            h.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    }

    static final Pattern INLINE_SCRIPT = Pattern.compile("<script(?![^>]*\\bsrc\\s*=)[^>]*>(.*?)</script>", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

    /** CSP for one HTML page. Inline <script> blocks are allowed by hash (computed from the page itself), so no 'unsafe-inline' for scripts.
     *  YouTube is allowed for the music player (API script + embed frame + thumbnails); Google Fonts for the typefaces. */
    static String cspFor(String html) {
        StringBuilder scripts = new StringBuilder("'self' https://www.youtube.com");
        Matcher m = INLINE_SCRIPT.matcher(html);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            while (m.find()) {
                String body = m.group(1).replace("\r\n", "\n");
                if (body.isBlank()) continue;
                scripts.append(" 'sha256-").append(Base64.getEncoder().encodeToString(md.digest(body.getBytes(StandardCharsets.UTF_8)))).append("'");
            }
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
        return "default-src 'self'; "
             + "script-src " + scripts + "; "
             + "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "   // inline style="" attributes are used in the pages
             + "font-src https://fonts.gstatic.com; "
             + "img-src 'self' data: blob: https://i.ytimg.com; "
             + "frame-src https://www.youtube.com; "
             + "connect-src 'self'; "
             + "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
    }

    static void send(HttpExchange ex, int code, String type, byte[] data) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        securityHeaders(ex, type);
        ex.sendResponseHeaders(code, data.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(data); }
    }
}