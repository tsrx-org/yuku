function* items(kind) {
  let a = <span>x</span>
  yield <li />
  switch (kind) {
    case 1: a = <span>y</span>
    case <li />: break
  }
  if (kind) a = <span>z</span>
  else <li />
}