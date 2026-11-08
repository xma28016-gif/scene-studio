# Scene Studio · 商品场景图生成器

[在线体验](https://scene-studio-six.vercel.app/prototype.html) · [MIT License](./LICENSE)

上传一张商品图，选择场景、比例和张数，也可以补充文字或语音描述。页面显示生成进度，并将生成图和原图保存到账号下的「我的作品」。

- **前端**：原生 HTML、CSS、JavaScript，支持图片压缩、HEIC 转换和浏览器听写。听写需要浏览器支持及麦克风权限。
- **生成**：服务端调用 Dify Chatflow，流式回传状态，并按所选比例裁切图片。
- **作品**：Supabase Auth 登录，Postgres 与私有 Storage 保存作品，按账号限制访问。

## 本地运行

需要 Node.js 24 和自己的 Supabase、Dify 项目。

1. 在 Supabase SQL Editor 执行 [supabase/my-works.sql](./supabase/my-works.sql)，创建作品表、访问策略和私有图片桶。启用邮箱密码登录，并将本地或部署地址加入 Authentication 的重定向地址。
2. 在 Dify 发布一个 Chatflow。使用下列输入变量；让流程读取聊天消息中的画面描述，并返回该应用可访问的生成图地址。

   | 变量 | 用途 |
   | --- | --- |
   | `product_image` | 单张上传的商品图 |
   | `ratio` | 图片宽高比，如 `3:4` |
   | `scene` | `两种都要`、`纯商品展示场景` 或 `人机交互场景` |
   | `count` | 生成张数，1–4 |

   当前实现使用 Dify Cloud，图片地址须符合 [服务端白名单](./server/dify.js)。自行部署 Dify 时，需按实际地址调整白名单。

3. 配置并启动：

   ```sh
   cp .env.example .env.local
   # 编辑 .env.local，填入自己的 Supabase URL、publishable key 和 Dify 应用密钥
   npm ci
   npm run build
   npm run dev
   ```

   浏览器打开 [http://127.0.0.1:4173](http://127.0.0.1:4173)。修改 Supabase 配置后重新运行构建。Dify 密钥仅在服务端使用；前端使用 Supabase publishable key，不需要 service role 密钥。

## 部署到 Vercel

导入仓库，在项目环境变量中配置与 `.env.example` 同名的变量。仓库内的 [vercel.json](./vercel.json) 提供安装、构建及 Functions 配置。部署后将实际域名加入 Supabase 的认证重定向地址。

源码与项目自带的海浪背景采用 MIT 许可；第三方依赖按各自许可证分发。此仓库不包含生产凭据、用户作品或已部署的 Dify 工作流配置。
