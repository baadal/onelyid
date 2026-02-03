# onelyid

Add [ATProto](https://atproto.com/) login to your Application<sup>*</sup> in minutes

## Install package
```bash
npm install @onelyid/express
```

## Usage in Application
```js
import { authMiddleware } from '@onelyid/express'

// const app = express()
app.use(authMiddleware())

app.get('/login', (req, _res) => {
  req.authFlow()
})
```
That's it!  
You can now navigate to `/login` endpoint in your application to see the login process in action.  
Note that unlike other Auth solutions, you don't need to register your application anywhere, as [AT Protocol](https://atproto.com/) is designed to be _permissionless_.

Full docs coming soon!

## Notes<sup>*</sup>
- Currently, only [Express.js](https://expressjs.com/) applications are supported.
- Support for other frameworks like _Next.js_ is coming soon!
- Native Apps are not supported for now, but planned for future.
