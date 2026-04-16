import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formTesterApi } from '@/lib/form-tester/api'
import { Loader2 } from 'lucide-react'

interface CreateWorkflowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateWorkflowModal({ open, onOpenChange }: CreateWorkflowModalProps) {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    target_url: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name.trim() || !formData.target_url.trim()) {
      return
    }

    setIsLoading(true)
    try {
      const newWorkflow = await formTesterApi.createWorkflow(
        formData.name,
        formData.target_url
      )

      if (newWorkflow) {
        onOpenChange(false)
        setFormData({ name: '', target_url: '' })
        navigate(`/app/workflows/form-tester/${newWorkflow.id}`)
      }
    } catch (error) {
      console.error('Failed to create workflow:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Créer un nouveau workflow</DialogTitle>
          <DialogDescription>
            Définissez le nom et l'URL cible de votre workflow de test de formulaire.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nom du workflow</Label>
            <Input
              id="name"
              placeholder="Ex: Test login form"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={isLoading}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL cible</Label>
            <Input
              id="url"
              placeholder="https://example.com/login"
              type="url"
              value={formData.target_url}
              onChange={(e) => setFormData({ ...formData, target_url: e.target.value })}
              disabled={isLoading}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !formData.name.trim() || !formData.target_url.trim()}
            >
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Créer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
