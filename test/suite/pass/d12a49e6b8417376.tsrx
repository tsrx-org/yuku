function App() @{
  @switch (x) {
    @case 1: /* c */ {
      const y = 1;
      <b>{y}</b>
    }
    @default: {
      // only a comment
    }
  }
}