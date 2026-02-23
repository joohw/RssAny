// 插件的路由定义
export interface RouteDef<TInput = unknown> {
    pattern: string; // e.g. "/medium/:userId"
    description?: string;
    buildInput(args: {
      params: Record<string, string>;
      query: Record<string, string | string[] | undefined>;
      path: string;
    }): TInput;
  }
  