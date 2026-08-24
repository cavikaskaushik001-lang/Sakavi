declare module 'dockerode' {
  export interface Container {
    id: string;
    start(): Promise<void>;
    stop(opts?: { t?: number }): Promise<void>;
    remove(opts?: { force?: boolean }): Promise<void>;
    exec(opts: {
      Cmd: string[];
      AttachStdout?: boolean;
      AttachStderr?: boolean;
      User?: string;
      WorkingDir?: string;
    }): Promise<Exec>;
  }

  export interface Exec {
    start(opts: { hijack?: boolean; stdin?: boolean }): Promise<NodeJS.ReadableStream>;
    inspect(): Promise<{ ExitCode: number | null }>;
  }

  export interface Image {
    inspect(): Promise<unknown>;
  }

  export default class Docker {
    constructor(opts?: object);
    createContainer(opts: object): Promise<Container>;
    getImage(name: string): Image;
  }
}
