// RSS 2.0 输出结构

export interface RssChannel {
  title: string;
  link: string;
  description?: string;
  language?: string;
}

export interface RssEntry {
  title: string;
  link: string;
  description: string;
  guid?: string;
  published?: string;
}
