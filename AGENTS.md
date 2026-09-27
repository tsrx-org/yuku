# Agent instructions

## Cursor Bugbot

Cursor Bugbot reviews every push to a pull request in this repository. Every push you make to a pull request needs its Bugbot review read and resolved:

1. Wait for the `Cursor Bugbot` check to finish after the push (`gh pr checks <number> --watch`). A review can take about ten minutes.
2. Read its findings:

   ```sh
   gh api repos/tsrx-org/yuku/pulls/<number>/comments \
     --jq '.[] | select(.user.login | test("cursor")) | {id, path, line, body}'
   ```

3. Resolve every finding. Either fix it on the branch with a regression test and push, which starts a new review, or reply to the comment explaining why the finding is wrong.
4. Repeat until the latest review has no unresolved findings. A pull request with unresolved Bugbot findings is not done and is not merged.

A finding that turns up on a pull request after it merged gets its own fix pull request, one finding per pull request.
