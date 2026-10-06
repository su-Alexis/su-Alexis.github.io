// Authored content for the "hello world" easter egg. Plain text only; the animation
// player (ui/hello-animation.js) renders it with textContent.

export const LANGUAGES = Object.freeze([
  Object.freeze(['c', String.raw`printf("Hello, World!\n");`]),
  Object.freeze(['c++', 'std::cout << "Hello, World!" << std::endl;']),
  Object.freeze(['c#', 'Console.WriteLine("Hello, World!");']),
  Object.freeze(['python', 'print("Hello, World!")']),
  Object.freeze(['powershell', 'Write-Host "Hello, World!"']),
  Object.freeze(['bash', 'echo "Hello, World!"']),
  Object.freeze(['javascript', 'console.log("Hello, World!");']),
]);

export const BANNER = Object.freeze([
  String.raw` _   _      _ _         __        __         _     _ _ `,
  String.raw`| | | | ___| | | ___    \ \      / /__  _ __| | __| | |`,
  String.raw`| |_| |/ _ \ | |/ _ \    \ \ /\ / / _ \| '__| |/ _' | |`,
  String.raw`|  _  |  __/ | | (_) |    \ V  V / (_) | |  | | (_| |_|`,
  String.raw`|_| |_|\___|_|_|\___( )    \_/\_/ \___/|_|  |_|\__,_(_)`,
  String.raw`                    |/                                 `,
]);

// Steam rising off a fresh waffle, looped a few times.
// Steam curling up off a hot cup of coffee, looped a few times.
export const STEAM = Object.freeze([
  Object.freeze(['          (   )  (   ', '           ) (   ) ) ', '          (   ) (  ( ', '           ) )  ) (  ']),
  Object.freeze(['           ) (   ) ) ', '          (   ) (  ( ', '           ) )  ) (  ', '          (   )  (   ']),
  Object.freeze(['          (   ) (  ( ', '           ) )  ) (  ', '          (   )  (   ', '           ) (   ) ) ']),
  Object.freeze(['           ) )  ) (  ', '          (   )  (   ', '           ) (   ) ) ', '          (   ) (  ( ']),
]);

export const CUP = Object.freeze([
  '        .-------------.',
  '        |             |--.',
  '        |   HELLO,    |  |',
  '        |   WORLD!    |  |',
  "        |             |--'",
  "        '-------------'",
  '     ~~~~~~~~~~~~~~~~~~~~~~',
]);

export const OUTRO = Object.freeze([
  Object.freeze(['ok', '[ ok ] 7/7 builds passed. 0 warnings. 0 coffees spilled.']),
  Object.freeze(['out', 'Every programmer starts here. This one just kept going.']),
  Object.freeze(['out', "Welcome aboard, visitor. Type 'exit' to close this shell."]),
]);
