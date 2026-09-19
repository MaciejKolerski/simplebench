#include <libproc.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>

// Developer-only macOS physical-footprint sampler, built outside the repository.
int main(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    char *end;
    long pid = strtol(argv[i], &end, 10);
    if (*end || pid <= 0 || pid > 2147483647) return 2;
    struct rusage_info_v4 info = {0};
    if (proc_pid_rusage((int)pid, RUSAGE_INFO_V4, (rusage_info_t *)&info)) {
      fprintf(stderr, "Cannot sample PID %ld: %s (errno %d)\n", pid, strerror(errno), errno);
      return 1;
    }
    printf("%ld %llu %llu %llu %llu\n", pid, info.ri_phys_footprint,
           info.ri_resident_size, info.ri_lifetime_max_phys_footprint,
           info.ri_proc_start_abstime);
  }
}
