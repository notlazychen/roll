/// <reference types="vite/client" />

/** CSS Modules：import styles from './x.module.css' 得到 string 键类名映射 */
declare module '*.module.css' {
  const classes: { readonly [key: string]: string }
  export default classes
}

declare module '*.css' {
  const content: string
  export default content
}
