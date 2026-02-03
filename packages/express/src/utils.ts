import { getPackageName } from '@onelyid/common'

export function getAppPackageName() {
  return getPackageName(__dirname)
}
