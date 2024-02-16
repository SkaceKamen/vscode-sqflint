#define LOG_FILE(x) diag_log format["%1: %2", __FILE__, x]

#ifndef DEBUG
#define LOG1(x) diag_log format["%1", x]
#endif
