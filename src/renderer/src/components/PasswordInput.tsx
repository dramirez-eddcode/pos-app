import { forwardRef, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * Input de contraseña con botón de "ojo" para mostrar/ocultar el texto.
 * Reenvía todas las props del input (value, onChange, required, ref, etc.).
 */
const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className = '', ...rest },
  ref
) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        {...rest}
        ref={ref}
        type={show ? 'text' : 'password'}
        className={`${className} pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((s) => !s)}
        title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
})

export default PasswordInput
