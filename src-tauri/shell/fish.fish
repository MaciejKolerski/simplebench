function __simplebench_preexec --on-event fish_preexec
  printf '\e]133;C\a'
end

function __simplebench_postexec --on-event fish_postexec
  set -l exit_code $status
  printf '\e]133;D;%s\a' $exit_code
end

functions --copy fish_prompt __simplebench_user_prompt
function fish_prompt
  printf '\e]7;file://localhost%s\a\e]133;A\a' (string escape --style=url -- $PWD | string replace -a '%2F' '/')
  __simplebench_user_prompt
  printf '\e]133;B\a'
end
