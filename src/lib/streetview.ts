/** 街景图片单独放在这个目录；文件名是街景点的 imageId（GUID）加常见图片后缀。 */
export const STREETVIEW_DIR = 'data/streetview'
/** 服务端会按这些后缀依次查找同名图片。 */
export const STREETVIEW_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'] as const
/** 街景点图片 ID 必须是标准 GUID。 */
export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isGuid = (value: string) => GUID_PATTERN.test(value)
/** 前端读取街景图的地址；id 是街景点保存的 GUID。 */
export const streetViewUrl = (id: string) => `/streetview/${encodeURIComponent(id)}`
