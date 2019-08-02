import Axios from 'axios'

export function percyHealthCheck() {
  return Axios
    .get('http://localhost:5338/percy/healthcheck')
    .then(() =>  true)
    .catch(() =>  false)
}
