import { Cross1Icon } from '@radix-ui/react-icons';
import Button from '../../../components/ui/button/Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle, DialogTrigger, DialogClose } from '../../../components/ui/Dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/Tooltip';
import type { ApiInvitation, WebUser } from '@nangohq/types';
import { useState } from 'react';
import { apiDeleteInvite, apiDeleteTeamUser, useTeam } from '../../../hooks/useTeam';
import { useToast } from '../../../hooks/useToast';
import { useStore } from '../../../store';
import { useUser } from '../../../hooks/useUser';
import { useNavigate } from 'react-router-dom';

export const UserAction: React.FC<{ user: WebUser }> = ({ user }) => {
    const env = useStore((state) => state.env);
    const { toast } = useToast();
    const navigate = useNavigate();

    const { mutate } = useTeam(env);
    const { user: me } = useUser();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const onRemove = async () => {
        setLoading(true);
        const update = await apiDeleteTeamUser(env, { id: user.id });

        if (update && update.res.status === 200) {
            if (user.id === me!.id) {
                navigate('/');
                toast({ title: `You left the team successfully`, variant: 'success' });
                return;
            }

            toast({ title: `${user.name} has been removed from your team`, variant: 'success' });
            setOpen(false);
            void mutate();
        } else {
            toast({ title: 'An unexpected error occurred', variant: 'error' });
        }
        setLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                        <Button variant={'icon'}>
                            <Cross1Icon />
                        </Button>
                    </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Remove member</TooltipContent>
            </Tooltip>
            <DialogContent>
                <DialogTitle>Remove member</DialogTitle>
                <DialogDescription>
                    You are about to permanently remove <span className="font-semibold text-white">{user.email}</span> from your team. Are you sure you wish to
                    continue?
                </DialogDescription>
                <DialogFooter className="mt-4">
                    <DialogClose asChild>
                        <Button variant={'zinc'}>Cancel</Button>
                    </DialogClose>
                    <Button variant={'danger'} onClick={onRemove} isLoading={loading}>
                        Remove member
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const InvitationAction: React.FC<{ invitation: ApiInvitation }> = ({ invitation }) => {
    const env = useStore((state) => state.env);
    const { toast } = useToast();
    const { mutate } = useTeam(env);

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);

    const onRevoke = async () => {
        setLoading(true);
        const update = await apiDeleteInvite(env, { email: invitation.email });

        if (!update || update.res.status === 200) {
            toast({ title: `${invitation.email}'s invitation has successfully been revoked`, variant: 'success' });
            setOpen(false);
            void mutate();
        }
        setLoading(false);
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                        <Button variant={'icon'}>
                            <Cross1Icon />
                        </Button>
                    </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>Revoke invitation</TooltipContent>
            </Tooltip>
            <DialogContent>
                <DialogTitle>Revoke invitation</DialogTitle>
                <DialogDescription>
                    You are about to revoke <span className="font-semibold text-white">{invitation.email}</span>&apos;s invitation to join your team. Are you
                    sure you wish to continue?
                </DialogDescription>
                <DialogFooter className="mt-4">
                    <DialogClose asChild>
                        <Button variant={'zinc'}>Cancel</Button>
                    </DialogClose>
                    <Button variant={'danger'} onClick={onRevoke} isLoading={loading}>
                        Revoke invitation
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
