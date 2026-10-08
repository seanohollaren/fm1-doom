/* SPDX-License-Identifier: GPL-3.0-only */
/* The C library pieces the JieLi toolchain's libc does not have: a small printf family (the game formats a few
 * strings: HUD messages, lump names) and the output calls, which go nowhere on the device. */
#include <stdarg.h>
#include <stddef.h>
#include <stdint.h>

static void put(char **p, char *end, char c)
{
    if (*p < end)
        **p = c;
    (*p)++;
}

int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap)
{
    char *p = buf, *end = size ? buf + size - 1 : buf;
    for (; *fmt; fmt++) {
        if (*fmt != '%') {
            put(&p, end, *fmt);
            continue;
        }
        int left = 0, zero = 0, width = 0, prec = -1, lng = 0;
        fmt++;
        for (;; fmt++) {
            if (*fmt == '-') left = 1;
            else if (*fmt == '0') zero = 1;
            else if (*fmt != '+' && *fmt != ' ') break;
        }
        if (*fmt == '*') { width = va_arg(ap, int); fmt++; }
        else while (*fmt >= '0' && *fmt <= '9') width = width * 10 + (*fmt++ - '0');
        if (*fmt == '.') {
            prec = 0;
            fmt++;
            if (*fmt == '*') { prec = va_arg(ap, int); fmt++; }
            else while (*fmt >= '0' && *fmt <= '9') prec = prec * 10 + (*fmt++ - '0');
        }
        while (*fmt == 'l' || *fmt == 'h' || *fmt == 'z') { lng += *fmt == 'l'; fmt++; }
        char tmp[24];
        const char *s = tmp;
        int n = 0, neg = 0;
        switch (*fmt) {
        case 'c': tmp[0] = (char)va_arg(ap, int); n = 1; break;
        case 's':
            s = va_arg(ap, const char *);
            if (!s) s = "(null)";
            while (s[n] && (prec < 0 || n < prec)) n++;
            break;
        case 'd': case 'i': case 'u': case 'x': case 'X': case 'p': {
            unsigned long long v;
            unsigned base = (*fmt == 'x' || *fmt == 'X' || *fmt == 'p') ? 16u : 10u;
            if (*fmt == 'p') v = (uintptr_t)va_arg(ap, void *);
            else if (*fmt == 'd' || *fmt == 'i') {
                long long sv = lng >= 2 ? va_arg(ap, long long) : lng ? va_arg(ap, long) : va_arg(ap, int);
                neg = sv < 0;
                v = neg ? (unsigned long long)-sv : (unsigned long long)sv;
            } else v = lng >= 2 ? va_arg(ap, unsigned long long) : lng ? va_arg(ap, unsigned long) : va_arg(ap, unsigned);
            char *t = tmp + sizeof tmp;
            do {
                unsigned dgt = (unsigned)(v % base);
                *--t = (char)(dgt < 10u ? '0' + dgt : (*fmt == 'X' ? 'A' : 'a') + dgt - 10u);
                v /= base;
            } while (v);
            while (tmp + sizeof tmp - t < prec) *--t = '0';
            if (neg) *--t = '-';
            s = t;
            n = (int)(tmp + sizeof tmp - t);
            break;
        }
        case '%': tmp[0] = '%'; n = 1; break;
        default: tmp[0] = '?'; n = 1; break;
        }
        if (!left) for (int i = n; i < width; i++) put(&p, end, zero && *fmt != 's' ? '0' : ' ');
        for (int i = 0; i < n; i++) put(&p, end, s[i]);
        if (left) for (int i = n; i < width; i++) put(&p, end, ' ');
    }
    if (size)
        *(p < end ? p : end) = 0;
    return (int)(p - buf);
}

int snprintf(char *buf, size_t size, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, size, fmt, ap);
    va_end(ap);
    return n;
}
int sprintf(char *buf, const char *fmt, ...)
{
    va_list ap;
    va_start(ap, fmt);
    int n = vsnprintf(buf, 0x7FFFFFFF, fmt, ap);
    va_end(ap);
    return n;
}
int vprintf(const char *fmt, va_list ap) { (void)fmt; (void)ap; return 0; }
int printf(const char *fmt, ...) { (void)fmt; return 0; }
int puts(const char *s) { (void)s; return 0; }
int putchar(int c) { return c; }
int sscanf(const char *s, const char *fmt, ...) { (void)s; (void)fmt; return 0; }
