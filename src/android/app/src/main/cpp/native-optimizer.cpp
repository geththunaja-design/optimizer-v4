// Optimizer V.4.0 - NDK layer (C/C++)
// ===================================
// Everything a NON-ROOT Android app is genuinely allowed to read or change.
// Nothing here touches another app's memory, CPU governor, GPU clocks or thermal limits:
// Android's sandbox forbids that without root, and a permission cannot grant it.
//
//   /proc/meminfo          -> total / available / cached RAM      (world readable)
//   /proc/stat             -> system-wide CPU busy percentage     (world readable)
//   /proc/cpuinfo          -> SoC model + per-core clock table    (world readable)
//   /sys/class/thermal/*   -> SoC temperature where exposed        (world readable on most SoCs)
//   /sys/.../cpuinfo_max_freq -> real maximum clock of the cores
//   sched_setaffinity + setpriority -> pins THIS app's threads to the fast cores and raises
//     their own scheduler priority. That is the only governor knob a non-root app owns, and it
//     is real: it makes this app's own frame delivery measurably more consistent.
//   native benchmark       -> an integer + float workload scored on 1 thread and on all cores,
//     so the CPU benchmark is the same on every device instead of JS-engine dependent.
//
// Built by CMake as liboptimizer.so and loaded by NativeBridge.kt.

#include <jni.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>
#include <thread>
#include <atomic>
#include <chrono>

#include <sched.h>
#include <unistd.h>
#include <sys/resource.h>
#include <sys/syscall.h>

namespace {

std::string readFile(const char *path, size_t maxBytes = 4096) {
    FILE *f = fopen(path, "r");
    if (!f) return std::string();
    std::vector<char> buf(maxBytes + 1);
    size_t n = fread(buf.data(), 1, maxBytes, f);
    fclose(f);
    buf[n] = 0;
    return std::string(buf.data(), n);
}

long parseLongAfter(const std::string &src, const char *key) {
    size_t p = src.find(key);
    if (p == std::string::npos) return -1;
    p += strlen(key);
    while (p < src.size() && (src[p] == ':' || src[p] == ' ' || src[p] == '\t')) p++;
    return strtol(src.c_str() + p, nullptr, 10);
}

std::string trim(const std::string &s) {
    size_t a = s.find_first_not_of(" \t\r\n");
    if (a == std::string::npos) return std::string();
    size_t b = s.find_last_not_of(" \t\r\n");
    return s.substr(a, b - a + 1);
}

std::string jsonEscape(const std::string &s) {
    std::string o;
    for (char c : s) {
        if (c == '"' || c == '\\') { o.push_back('\\'); o.push_back(c); }
        else if (c == '\n' || c == '\r' || c == '\t') o.push_back(' ');
        else o.push_back(c);
    }
    return o;
}

long cpuMaxKhz(int core) {
    char path[128];
    snprintf(path, sizeof(path), "/sys/devices/system/cpu/cpu%d/cpufreq/cpuinfo_max_freq", core);
    long v = parseLongAfter(readFile(path, 64), "");   // whole file is the number
    if (v <= 0) return -1;
    return v;
}

int configuredCores() {
    int n = (int) sysconf(_SC_NPROCESSORS_CONF);
    return n > 0 ? n : 1;
}

/* A workload that is identical on every device: integer mix + float mix.
   Returns millions of operations per second. */
struct BenchResult { double single = 0, multi = 0; int threads = 0; };

double runBench(uint64_t iters) {
    uint64_t x = 0x9E3779B97F4A7C15ull;
    double f = 1.000001;
    for (uint64_t i = 0; i < iters; i++) {
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        f = f * 1.0000001 + 0.0000001;
        if (f > 2.0) f = 1.000001;
    }
    /* consume the results so nothing is optimised away */
    volatile uint64_t sink = x + (uint64_t) (f * 1000.0);
    (void) sink;
    return iters * 4.0;   // counted operations
}

BenchResult bench(int iters) {
    BenchResult r;
    if (iters <= 0) iters = 2000000;
    auto t0 = std::chrono::steady_clock::now();
    double ops = runBench((uint64_t) iters);
    auto t1 = std::chrono::steady_clock::now();
    double secs = std::chrono::duration<double>(t1 - t0).count();
    if (secs <= 0) secs = 1e-9;
    r.single = ops / secs / 1e6;

    int n = configuredCores();
    if (n > 8) n = 8;
    r.threads = n;
    std::atomic<double> total{0.0};
    std::vector<std::thread> pool;
    auto m0 = std::chrono::steady_clock::now();
    for (int i = 0; i < n; i++) {
        pool.emplace_back([&total, iters]() {
            total.fetch_add(runBench((uint64_t) iters), std::memory_order_relaxed);
        });
    }
    for (auto &t : pool) t.join();
    auto m1 = std::chrono::steady_clock::now();
    double msecs = std::chrono::duration<double>(m1 - m0).count();
    if (msecs <= 0) msecs = 1e-9;
    r.multi = total.load() / msecs / 1e6;
    return r;
}

}  // namespace

extern "C" {

JNIEXPORT jstring JNICALL
Java_com_aash_optimizer_NativeBridge_deviceInfo(JNIEnv *env, jobject) {
    std::string cpu = readFile("/proc/cpuinfo", 8192);
    std::string mem = readFile("/proc/meminfo", 4096);

    long totalKb = parseLongAfter(mem, "MemTotal");
    long availKb = parseLongAfter(mem, "MemAvailable");
    int cores = configuredCores();

    std::string model;
    const char *keys[] = {"Hardware", "model name", "Processor", "PROCESSOR"};
    for (const char *k : keys) {
        size_t p = cpu.find(k);
        if (p == std::string::npos) continue;
        size_t e = cpu.find('\n', p);
        std::string line = e == std::string::npos ? cpu.substr(p) : cpu.substr(p, e - p);
        size_t c = line.find(':');
        if (c != std::string::npos) model = trim(line.substr(c + 1));
        if (!model.empty()) break;
    }
    if (model.empty()) {
        size_t p = cpu.find("CPU architecture");
        if (p != std::string::npos) {
            size_t e = cpu.find('\n', p);
            size_t c = cpu.find(':', p);
            if (c != std::string::npos && e != std::string::npos && e > c) model = "ARMv" + trim(cpu.substr(c + 1, e - c - 1));
        }
    }

    long maxKhz = -1;
    for (int i = 0; i < cores; i++) {
        long v = cpuMaxKhz(i);
        if (v > maxKhz) maxKhz = v;
    }

    std::string out = "{";
    out += "\"cores\":" + std::to_string(cores);
    out += ",\"totalRamMb\":" + std::to_string(totalKb > 0 ? totalKb / 1024 : -1);
    out += ",\"availRamMb\":" + std::to_string(availKb > 0 ? availKb / 1024 : -1);
    out += ",\"cpuModel\":\"" + jsonEscape(model) + "\"";
    out += ",\"cpuMaxMhz\":" + std::to_string(maxKhz > 0 ? maxKhz / 1000 : -1);
    out += "}";
    return env->NewStringUTF(out.c_str());
}

JNIEXPORT jint JNICALL
Java_com_aash_optimizer_NativeBridge_cpuLoadPercent(JNIEnv *, jobject) {
    static long long prevTotal = 0, prevIdle = 0;
    std::string s = readFile("/proc/stat", 2048);
    size_t nl = s.find('\n');
    if (nl == std::string::npos) return -1;
    std::string line = s.substr(0, nl);
    if (line.size() < 20 || line.compare(0, 3, "cpu") != 0) return -1;
    long long v[10] = {0};
    int got = sscanf(line.c_str() + 3, "%lld %lld %lld %lld %lld %lld %lld %lld %lld %lld",
                     &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6], &v[7], &v[8], &v[9]);
    if (got < 4) return -1;
    long long idle = v[3] + v[4];
    long long total = 0;
    for (int i = 0; i < 10; i++) total += v[i];
    long long dTotal = total - prevTotal, dIdle = idle - prevIdle;
    prevTotal = total;
    prevIdle = idle;
    if (dTotal <= 0) return -1;
    long long busy = dTotal - dIdle;
    if (busy < 0) busy = 0;
    return (jint) ((busy * 100) / dTotal);
}

JNIEXPORT jstring JNICALL
Java_com_aash_optimizer_NativeBridge_memInfoMb(JNIEnv *env, jobject) {
    std::string mem = readFile("/proc/meminfo", 4096);
    long total = parseLongAfter(mem, "MemTotal");
    long avail = parseLongAfter(mem, "MemAvailable");
    long cached = parseLongAfter(mem, "Cached");
    long swapTotal = parseLongAfter(mem, "SwapTotal");
    long swapFree = parseLongAfter(mem, "SwapFree");
    std::string out = "{\"total\":" + std::to_string(total > 0 ? total / 1024 : -1) +
        ",\"available\":" + std::to_string(avail > 0 ? avail / 1024 : -1) +
        ",\"cached\":" + std::to_string(cached > 0 ? cached / 1024 : -1) +
        ",\"swapTotal\":" + std::to_string(swapTotal > 0 ? swapTotal / 1024 : -1) +
        ",\"swapUsed\":" + std::to_string(swapTotal > 0 && swapFree >= 0 ? (swapTotal - swapFree) / 1024 : -1) +
        "}";
    return env->NewStringUTF(out.c_str());
}

JNIEXPORT jfloat JNICALL
Java_com_aash_optimizer_NativeBridge_thermalCelsius(JNIEnv *, jobject) {
    float best = -1.f;
    for (int i = 0; i < 24; i++) {
        char path[96];
        snprintf(path, sizeof(path), "/sys/class/thermal/thermal_zone%d/temp", i);
        std::string s = readFile(path, 64);
        if (s.empty()) {
            if (i > 6) break;
            continue;
        }
        float t = (float) strtod(s.c_str(), nullptr);
        if (t > 1000.f) t /= 1000.f;         // milli-degree zones
        if (t > 0.f && t < 200.f && t > best) best = t;
    }
    if (best < 0.f) {
        std::string cpu = readFile("/sys/class/thermal/thermal_zone0/temp", 64);
        if (!cpu.empty()) {
            float t = (float) strtod(cpu.c_str(), nullptr);
            if (t > 1000.f) t /= 1000.f;
            if (t > 0.f && t < 200.f) best = t;
        }
    }
    return best;
}

/** Pin this app's calling thread to the fastest cores and raise its own priority.
    Affects THIS process only - it is the one real "governor" a non-root app owns. */
JNIEXPORT jboolean JNICALL
Java_com_aash_optimizer_NativeBridge_lockAppThreads(JNIEnv *, jobject, jint cores) {
    cpu_set_t set;
    CPU_ZERO(&set);
    int n = configuredCores();
    int use = cores > 0 ? cores : n;
    if (use > n) use = n;
    int first = n - use;
    if (first < 0) first = 0;
    for (int i = first; i < n; i++) CPU_SET(i, &set);
    bool ok = sched_setaffinity((pid_t) syscall(SYS_gettid), sizeof(set), &set) == 0;
    setpriority(PRIO_PROCESS, (id_t) syscall(SYS_gettid), -8);
    return ok ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL
Java_com_aash_optimizer_NativeBridge_benchNative(JNIEnv *env, jobject, jint iters) {
    BenchResult r = bench((int) iters);
    char out[256];
    snprintf(out, sizeof(out),
             "{\"singleMops\":%.1f,\"multiMops\":%.1f,\"threads\":%d}",
             r.single, r.multi, r.threads);
    return env->NewStringUTF(out);
}

}  // extern "C"
