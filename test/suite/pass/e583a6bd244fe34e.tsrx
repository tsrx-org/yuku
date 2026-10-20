function A() @{
  @try {
    <b />
  } @pending // c
  {
    <p />
  } @catch /* d */ (e) {
    <i />
  }
}