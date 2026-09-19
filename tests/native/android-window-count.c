// macOS-only fixture: report window counts for explicitly supplied process IDs.
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  CFArrayRef windows = CGWindowListCopyWindowInfo(kCGWindowListOptionAll,
                                                 kCGNullWindowID);
  if (!windows) return 3;
  printf("{");
  for (int arg = 1; arg < argc; arg++) {
    char *end;
    long requested = strtol(argv[arg], &end, 10);
    if (*end || requested <= 0 || requested > 2147483647) return 2;
    int count = 0;
    for (CFIndex index = 0; index < CFArrayGetCount(windows); index++) {
      CFDictionaryRef window = CFArrayGetValueAtIndex(windows, index);
      CFNumberRef owner = CFDictionaryGetValue(window, kCGWindowOwnerPID);
      int pid = 0;
      if (owner && CFNumberGetValue(owner, kCFNumberIntType, &pid) && pid == requested)
        count++;
    }
    printf("%s\"%ld\":%d", arg == 1 ? "" : ",", requested, count);
  }
  printf("}\n");
  CFRelease(windows);
  return 0;
}
