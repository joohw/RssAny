// HTTP 错误：router 捕获后返回对应状态码页面

export class AuthRequiredError extends Error {
  constructor(message = "需要登录") {
    super(message);
    this.name = "AuthRequiredError";
  }
}


export class NotFoundError extends Error {
  constructor(message = "未找到") {
    super(message);
    this.name = "NotFoundError";
  }
}
